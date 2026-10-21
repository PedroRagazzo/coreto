// "Coreto Música": um robô que entra na sala de voz de quem pede e toca links do YouTube e do Spotify.
// Os comandos são mensagens de chat ("/play ..."); as respostas voltam como mensagens do robô. O áudio
// vai pela própria chamada, como mais um participante (bot-voice.ts), então o volume por pessoa, o anel
// de quem fala e "ensurdecer" funcionam como com qualquer outra voz.

import type { Channel, Id, Message } from '../../../shared/src/models.js';
import { hasPermission, Permission } from '../../../shared/src/permissions.js';
import { MAX_MESSAGE_LENGTH, type SignalPayload } from '../../../shared/src/protocol.js';
import { joinPublicSpaces } from '../realtime/membership.js';
import { rooms, type IO } from '../realtime/types.js';
import { broadcastRoster, endVoiceSession } from '../realtime/voice.js';
import type { Store, VoiceObserver, VoiceSession } from '../store.js';
import type { IceConfig } from '../turn.js';
import { BotVoice, type Wrtc } from './bot-voice.js';
import { HELP_TEXT, parseCommand, type MusicCommand } from './commands.js';
import type { MusicConfig } from './config.js';
import { parseMusicRequest } from './links.js';
import { FramePacer } from './pacer.js';
import { describeTrack, formatDuration, TrackQueue, type Track } from './queue.js';
import { MusicError, type AudioHandle, type MusicSource } from './source.js';

export const BOT_NAME = 'Coreto Música';
export const BOT_COLOR = '#e5a54b';
/** Identifica a sessão de voz do bot: não é um socket de verdade. */
export const BOT_SOCKET_ID = 'bot:musica';

/** Quanto áudio fica pronto na frente do relógio; passou disso, o download espera. */
const BUFFER_HIGH_MS = 4000;
const BUFFER_LOW_MS = 1500;
const TICK_MS = 250;
/** Sem ninguém na sala, o bot espera um pouco (quem caiu pode voltar) e sai. */
const EMPTY_ROOM_LEAVE_MS = 60_000;
const QUEUE_LINES = 10;
const MAX_VOLUME = 150;

interface Playing {
  track: Track;
  handle: AudioHandle;
  /** O download está parado porque já há áudio de sobra. */
  throttled: boolean;
}

interface Room {
  channelId: Id;
  spaceId: Id;
  voice: BotVoice;
  pacer: FramePacer;
  queue: TrackQueue;
  session: VoiceSession;
  now: Playing | null;
  paused: boolean;
  volume: number;
  /** Onde responder: o canal de texto do último comando. */
  textChannel: Channel;
  emptySince: number | null;
  idleSince: number | null;
  timer: ReturnType<typeof setInterval>;
}

export interface MusicBotDeps {
  io: IO;
  store: Store;
  ice: IceConfig;
  source: MusicSource;
  config: MusicConfig;
  wrtc: Wrtc;
  userId: Id;
}

export class MusicBot implements VoiceObserver {
  private room: Room | null = null;
  /** Um comando de cada vez: dois "/play" juntos não podem se atropelar. */
  private commands: Promise<void> = Promise.resolve();

  constructor(private readonly deps: MusicBotDeps) {}

  get userId(): Id {
    return this.deps.userId;
  }

  // ── Entradas ───────────────────────────────────────────────────────────────

  /** Chame para cada mensagem nova de canal; só reage a comandos de pessoas. */
  onMessage(message: Message, channel: Channel): void {
    if (message.authorId === this.userId || this.deps.store.users.get(message.authorId)?.isBot) return;
    const command = parseCommand(message.content);
    if (!command) return;
    this.commands = this.commands
      .then(() => this.run(command, message.authorId, channel))
      .catch((err: unknown) => console.error('[música] comando', command.name, err));
  }

  signal(from: Id, to: Id, signal: SignalPayload): boolean {
    if (to !== this.userId) return false;
    this.room?.voice.handleSignal(from, signal);
    return true;
  }

  sessionEnded(session: VoiceSession): void {
    const room = this.room;
    if (!room || session.userId === this.userId || session.channelId !== room.channelId) return;
    room.voice.closePeer(session.userId);
    if (this.humans(room) === 0) room.emptySince = Date.now();
  }

  /** Encerra tudo (o servidor está desligando). */
  shutdown(): void {
    if (this.room) this.leave(this.room);
  }

  // ── Comandos ───────────────────────────────────────────────────────────────

  private async run(command: MusicCommand, authorId: Id, channel: Channel): Promise<void> {
    const { store } = this.deps;
    if (command.name === 'help') return this.say(channel, HELP_TEXT);

    const author = store.voice.get(authorId);
    if (!author || author.socketId === BOT_SOCKET_ID) {
      return this.say(channel, 'Entre em um canal de voz antes de usar os comandos de música.');
    }
    if (command.name === 'play') return this.play(command.args, authorId, author, channel);

    const room = this.room;
    if (!room || room.channelId !== author.channelId) {
      return this.say(channel, room ? `Só quem está no canal de voz onde estou tocando (${this.channelName(room.channelId)}) pode usar esse comando.` : 'Não estou tocando nada agora.');
    }
    room.textChannel = channel;

    switch (command.name) {
      case 'skip':
        if (!room.now) return this.say(channel, 'Não há nada tocando.');
        await this.say(channel, `Pulei **${room.now.track.title}**.`);
        return this.playNext(room);
      case 'pause':
        if (!room.now) return this.say(channel, 'Não há nada tocando.');
        room.paused = true;
        room.pacer.pause();
        return this.say(channel, 'Pausado. Use `/resume` para continuar.');
      case 'resume':
        if (!room.paused) return this.say(channel, 'Não está pausado.');
        room.paused = false;
        if (room.now) room.pacer.start();
        return this.say(channel, 'Continuando.');
      case 'stop':
        await this.say(channel, 'Parando e saindo da chamada.');
        return this.leave(room);
      case 'clear': {
        const removed = room.queue.clearWaiting();
        return this.say(channel, removed > 0 ? `Tirei ${removed} música${removed === 1 ? '' : 's'} da fila.` : 'A fila já está vazia.');
      }
      case 'queue':
        return this.say(channel, this.describeQueue(room));
      case 'now':
        return this.say(channel, room.now ? `Tocando: ${describeTrack(room.now.track)} · pedido por ${room.now.track.requestedBy}` : 'Não há nada tocando.');
      case 'volume': {
        if (!command.args) return this.say(channel, `Volume: ${room.volume}%.`);
        const value = Number(command.args.replace('%', ''));
        if (!Number.isFinite(value) || value < 0 || value > MAX_VOLUME) {
          return this.say(channel, `Use um número de 0 a ${MAX_VOLUME} (100 é o volume normal).`);
        }
        room.volume = Math.round(value);
        room.pacer.gain = room.volume / 100;
        return this.say(channel, `Volume: ${room.volume}%. (Cada pessoa também pode ajustar a minha voz só para si, clicando com o botão direito em mim.)`);
      }
    }
  }

  private async play(args: string, authorId: Id, author: VoiceSession, channel: Channel): Promise<void> {
    const { store, config, source } = this.deps;
    const request = parseMusicRequest(args);
    if (request.kind === 'invalid') return this.say(channel, request.reason);
    if (this.room && this.room.channelId !== author.channelId) {
      if (this.humans(this.room) > 0) {
        return this.say(channel, `Já estou tocando em ${this.channelName(this.room.channelId)}. Entre lá ou espere acabar.`);
      }
      this.leave(this.room);
    }
    const requestedBy = store.users.get(authorId)?.displayName ?? 'alguém';

    const capacity = config.maxQueue - (this.room?.queue.size ?? 0);
    if (capacity <= 0) return this.say(channel, `A fila está cheia (${config.maxQueue} músicas).`);

    let tracks: Track[];
    try {
      tracks = await source.resolve(request, requestedBy, Math.min(capacity, config.maxPlaylistTracks));
    } catch (err) {
      if (err instanceof MusicError) return this.say(channel, err.message);
      throw err;
    }

    // Quem pediu pode ter saído da sala enquanto a busca rodava.
    const still = store.voice.get(authorId);
    if (!still || still.channelId !== author.channelId) return;
    const room = this.room ?? (await this.join(author, channel));
    if (!room) return this.say(channel, 'Não consegui entrar na chamada.');
    room.textChannel = channel;

    const wasIdle = !room.now;
    const added = room.queue.add(tracks);
    room.idleSince = null;
    if (wasIdle) {
      await this.playNext(room);
      if (added > 1) await this.say(channel, `Mais ${added - 1} músicas na fila.`);
    } else if (added === 1) {
      await this.say(channel, `Na fila (#${room.queue.size}): ${describeTrack(tracks[0])} · pedido por ${requestedBy}`);
    } else {
      await this.say(channel, `${added} músicas adicionadas à fila${added < tracks.length ? ` (a fila comporta ${config.maxQueue})` : ''}.`);
    }
  }

  private describeQueue(room: Room): string {
    const lines: string[] = [];
    if (room.now) lines.push(`Tocando: ${describeTrack(room.now.track)} · pedido por ${room.now.track.requestedBy}`);
    const upcoming = room.queue.upcoming();
    if (upcoming.length === 0) lines.push('A fila está vazia.');
    else {
      lines.push(`Na fila (${upcoming.length}):`);
      upcoming.slice(0, QUEUE_LINES).forEach((track, i) => lines.push(`${i + 1}. ${describeTrack(track)}`));
      if (upcoming.length > QUEUE_LINES) lines.push(`… e mais ${upcoming.length - QUEUE_LINES}.`);
      const total = upcoming.reduce((sum, t) => sum + (t.durationSeconds ?? 0), 0);
      if (total > 0) lines.push(`Tempo da fila: ${formatDuration(total)}`);
    }
    return lines.join('\n');
  }

  // ── Sala de voz ────────────────────────────────────────────────────────────

  /** Entra no canal de voz de quem pediu e liga para quem já está lá. */
  private async join(author: VoiceSession, channel: Channel): Promise<Room | null> {
    const { io, store, ice, wrtc, userId } = this.deps;
    const voiceChannel = store.channels.get(author.channelId);
    if (!voiceChannel) return null;
    await joinPublicSpaces(io, store, userId);

    const voice = new BotVoice({
      wrtc,
      botId: userId,
      iceServers: ice.iceServers(userId),
      iceTransportPolicy: ice.transportPolicy,
      sendSignal: (to, signal) => {
        const target = store.voice.get(to);
        if (target && target.channelId === voiceChannel.id) io.to(target.socketId).emit('voice:signal', { from: userId, signal });
      },
    });
    const session: VoiceSession = {
      userId,
      channelId: voiceChannel.id,
      spaceId: voiceChannel.spaceId,
      muted: false,
      deafened: false,
      video: false,
      streaming: false,
      streamTitle: null,
      activity: null,
      watching: null,
      socketId: BOT_SOCKET_ID,
      streamPreview: null,
      streamPreviewAt: 0,
    };
    const pacer = new FramePacer(
      (frame) => voice.pushFrame(frame),
      () => this.onTrackEnded(),
    );
    const room: Room = {
      channelId: voiceChannel.id,
      spaceId: voiceChannel.spaceId,
      voice,
      pacer,
      queue: new TrackQueue(this.deps.config.maxQueue),
      session,
      now: null,
      paused: false,
      volume: 100,
      textChannel: channel,
      emptySince: null,
      idleSince: null,
      timer: setInterval(() => this.tick(), TICK_MS),
    };
    this.room = room;

    const present = store.voiceIn(voiceChannel.id).map((s) => s.userId);
    store.voice.set(userId, session);
    broadcastRoster(io, store, session.spaceId, session.channelId);
    voice.join(present);
    return room;
  }

  private leave(room: Room): void {
    if (this.room !== room) return;
    this.room = null;
    clearInterval(room.timer);
    room.now?.handle.stop();
    room.now = null;
    room.pacer.stop();
    room.queue.reset();
    room.voice.close();
    const { io, store } = this.deps;
    if (store.voice.get(this.userId) === room.session) endVoiceSession(io, store, room.session);
  }

  private humans(room: Room): number {
    return this.deps.store.voiceIn(room.channelId).filter((s) => s.socketId !== BOT_SOCKET_ID).length;
  }

  private channelName(channelId: Id): string {
    const channel = this.deps.store.channels.get(channelId);
    return channel ? `#${channel.name}` : 'outro canal';
  }

  /** Vigia o essencial a cada instante: o ritmo do download, a sala vazia e a fila parada. */
  private tick(): void {
    const room = this.room;
    if (!room) return;
    const { now } = room;
    if (now) {
      if (now.throttled && room.pacer.bufferedMs < BUFFER_LOW_MS) {
        now.throttled = false;
        now.handle.pcm.resume();
      }
    } else if (room.idleSince !== null && Date.now() - room.idleSince > this.deps.config.idleSeconds * 1000) {
      void this.say(room.textChannel, 'Fila vazia, saindo da chamada. Use `/play` para me chamar de novo.').then(() => this.leave(room));
      room.idleSince = null;
    }
    if (room.emptySince !== null) {
      if (this.humans(room) > 0) room.emptySince = null;
      else if (Date.now() - room.emptySince > EMPTY_ROOM_LEAVE_MS) this.leave(room);
    }
  }

  // ── Reprodução ─────────────────────────────────────────────────────────────

  /** Para a música de agora (se houver) e começa a próxima da fila. */
  private async playNext(room: Room): Promise<void> {
    room.now?.handle.stop();
    room.now = null;
    room.pacer.stop();
    const track = room.queue.advance();
    if (!track) {
      this.setActivity(room, null);
      room.idleSince = Date.now();
      return;
    }
    room.idleSince = null;
    const handle = this.deps.source.open(track);
    const playing: Playing = { track, handle, throttled: false };
    room.now = playing;
    room.pacer.gain = room.volume / 100;
    this.setActivity(room, track.title);

    handle.pcm.on('data', (chunk: Buffer) => {
      if (room.now !== playing) return;
      room.pacer.push(chunk);
      if (room.pacer.bufferedMs > BUFFER_HIGH_MS) {
        playing.throttled = true;
        handle.pcm.pause();
      }
    });
    handle.pcm.on('end', () => {
      if (room.now === playing) room.pacer.end();
    });
    void handle.finished.then(({ error }) => {
      if (room.now !== playing || !error) return;
      void this.say(room.textChannel, `Não consegui tocar **${track.title}**: ${error}`);
    });
    if (!room.paused) room.pacer.start();
    await this.say(room.textChannel, `▶ Tocando agora: ${describeTrack(track)} · pedido por ${track.requestedBy}`);
  }

  private onTrackEnded(): void {
    const room = this.room;
    if (!room) return;
    this.commands = this.commands.then(() => this.playNext(room)).catch((err: unknown) => console.error('[música] próxima', err));
  }

  private setActivity(room: Room, text: string | null): void {
    const activity = text ? `♪ ${text}`.slice(0, 100) : null;
    if (room.session.activity === activity) return;
    room.session.activity = activity;
    broadcastRoster(this.deps.io, this.deps.store, room.spaceId, room.channelId);
  }

  // ── Respostas ──────────────────────────────────────────────────────────────

  private async say(channel: Channel, text: string): Promise<void> {
    const { io, store, userId } = this.deps;
    try {
      await joinPublicSpaces(io, store, userId);
      if (!hasPermission(store.permissionsFor(userId, channel), Permission.SEND_MESSAGES)) return;
      const message = await store.addMessage(channel.id, userId, text.slice(0, MAX_MESSAGE_LENGTH));
      io.to(rooms.channel(channel.id)).emit('message:new', message);
    } catch (err) {
      console.error('[música] não consegui responder no chat', err);
    }
  }
}
