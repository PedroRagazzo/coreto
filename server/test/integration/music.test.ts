import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { Message, VoiceParticipant } from '../../../shared/src/models.js';
import { loadWrtc, type Wrtc } from '../../src/music/bot-voice.js';
import { BOT_NAME } from '../../src/music/bot.js';
import { createMusic, musicConfigFromEnv, type MusicBot } from '../../src/music/index.js';
import { hasTestDatabase } from '../support/database.js';
import { FakeMusicSource } from '../support/fake-music-source.js';
import { channelNamed, joinDemoSpace, nextEvent, ok, TestServer, type TestClient } from '../support/harness.js';
import { makeHuman, type Human } from '../support/voice-peer.js';

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function until(check: () => boolean, ms = 10_000): Promise<void> {
  const deadline = Date.now() + ms;
  while (!check()) {
    if (Date.now() > deadline) throw new Error('tempo esgotado');
    await wait(50);
  }
}

describe.skipIf(!hasTestDatabase)('bot de música', () => {
  let server: TestServer;
  let wrtc: Wrtc;
  const source = new FakeMusicSource();
  const humans: Human[] = [];
  let bot: MusicBot | null = null;

  beforeAll(async () => {
    wrtc = await loadWrtc();
    const make = createMusic({ ...musicConfigFromEnv({}), idleSeconds: 1 }, { source, checkTools: false });
    server = await TestServer.start({
      music: async (context) => (bot = await make(context)),
    });
  });
  afterAll(async () => {
    await server.stop();
  });
  afterEach(async () => {
    for (const human of humans.splice(0)) human.close();
    // Um teste que falha no meio não pode deixar o bot tocando para o seguinte.
    bot?.shutdown();
    await server.disconnectAll();
  });

  interface Person {
    client: TestClient;
    human: Human;
    chat: string;
    voice: string;
    botId: string;
    /** Manda uma mensagem e espera as `count` respostas do bot (juntas, uma por linha). */
    say(text: string, count?: number): Promise<string>;
    /** Manda uma mensagem sem esperar resposta. */
    send(text: string): Promise<void>;
  }

  /** Alguém que entra na sala de voz com um "navegador" de WebRTC de verdade para ouvir o bot. */
  async function person(label: string, options: { inVoice?: boolean } = {}): Promise<Person> {
    const client = await server.connect(label);
    const snapshot = await joinDemoSpace(client);
    const chat = channelNamed(snapshot, 'geral').id;
    const voice = channelNamed(snapshot, 'Sala de estar').id;
    const botId = snapshot.users.find((u) => u.isBot && u.displayName === BOT_NAME)?.id ?? '';
    expect(botId).not.toBe('');
    const human = makeHuman(wrtc, { selfId: client.user.id, botId }, (signal) => client.socket.emit('voice:signal', { to: botId, signal }));
    humans.push(human);
    client.socket.on('voice:signal', ({ from, signal }) => {
      if (from === botId) human.receive(signal);
    });
    if (options.inVoice !== false) ok(await client.socket.emitWithAck('voice:join', { channelId: voice }));
    const send = async (text: string) => void ok(await client.socket.emitWithAck('message:send', { channelId: chat, content: text }));
    return {
      client,
      human,
      chat,
      voice,
      botId,
      send,
      async say(text, count = 1) {
        const replies: string[] = [];
        const done = new Promise<void>((resolve, reject) => {
          const timer = setTimeout(() => reject(new Error(`O bot respondeu ${replies.length} de ${count} mensagens a "${text}": ${replies.join(' | ')}`)), 8_000);
          const handler = (m: Message) => {
            if (m.authorId !== botId) return;
            replies.push(m.content);
            if (replies.length < count) return;
            clearTimeout(timer);
            client.socket.off('message:new', handler);
            resolve();
          };
          client.socket.on('message:new', handler);
        });
        await send(text);
        await done;
        return replies.join(' ¶ ');
      },
    };
  }

  const roster = (p: Person, check: (list: VoiceParticipant[]) => boolean) =>
    nextEvent(p.client.socket, 'voice:update', (u) => u.channelId === p.voice && check(u.participants)).then((u) => u.participants);

  it('toca o pedido na chamada: o bot entra na sala, o áudio chega e o chat recebe o aviso', async () => {
    const ana = await person('Ana');
    const entered = roster(ana, (list) => list.some((p) => p.userId === ana.botId && p.activity?.includes('luar')));
    const reply = await ana.say('/play luar do sertão');
    expect(reply).toContain('Tocando agora');
    expect(reply).toContain('luar do sertão');
    expect(reply).toMatch(/pedido por Ana/);

    const bot = (await entered).find((p) => p.userId === ana.botId)!;
    expect(bot.activity).toBe('♪ luar do sertão');
    await until(() => ana.human.stats().frames > 50);
    expect(ana.human.stats().peak).toBeGreaterThan(4000);

    expect(await ana.say('/stop')).toContain('saindo da chamada');
  }, 30_000);

  it('quem entra na sala depois também ouve o bot', async () => {
    const ana = await person('Ana');
    await ana.say('/play primeira');
    const bruno = await person('Bruno');
    bruno.human.callBot();
    await until(() => bruno.human.stats().frames > 50);
    expect(bruno.human.stats().peak).toBeGreaterThan(4000);
    await ana.say('/stop');
  }, 30_000);

  it('tem fila, pula, pausa, ajusta o volume e limpa', async () => {
    const ana = await person('Ana');
    expect(await ana.say('/play um')).toContain('Tocando agora');
    expect(await ana.say('/play dois')).toMatch(/Na fila \(#1\).*dois/);
    expect(await ana.say('/play https://youtu.be/dQw4w9WgXcQ')).toMatch(/Na fila \(#2\)/);

    const queue = await ana.say('/fila');
    expect(queue).toContain('Tocando: **um**');
    expect(queue).toContain('1. **dois**');
    expect(queue).toContain('2. **Vídeo dQw4w9WgXcQ**');

    expect(await ana.say('/volume 40')).toContain('Volume: 40%');
    expect(await ana.say('/volume 999')).toContain('de 0 a 150');
    expect(await ana.say('/pause')).toContain('Pausado');
    expect(await ana.say('/resume')).toContain('Continuando');
    expect(await ana.say('/skip', 2)).toContain('Pulei **um**');
    expect(await ana.say('/now')).toContain('**dois**');
    expect(await ana.say('/clear')).toContain('1 música');
    expect(await ana.say('/fila')).toContain('A fila está vazia');
    await ana.say('/stop');
  }, 30_000);

  it('passa para a próxima sozinho quando a música acaba, e sai quando a fila esvazia', async () => {
    const ana = await person('Ana');
    await ana.say('/play curta');
    const next = nextEvent(
      ana.client.socket,
      'message:new',
      (m) => m.authorId === ana.botId && m.content.includes('Tocando agora'),
      12_000,
    );
    await ana.send('/play seguinte');
    // A fake dura 4 s; ao acabar, a segunda começa.
    expect((await next).content).toContain('seguinte');
    // Depois da segunda, a fila esvazia e (com idleSeconds = 1) o bot sai.
    await nextEvent(ana.client.socket, 'voice:peer-left', (p) => p.userId === ana.botId, 15_000);
  }, 40_000);

  it('toca playlists e links do Spotify, entrando na fila em ordem', async () => {
    const ana = await person('Ana');
    const started = await ana.say('/play https://www.youtube.com/playlist?list=PLrAXtmErZgOeiKm4sgNOknGvNjby9efdf', 2);
    expect(started).toContain('Lista 1');
    expect(started).toContain('Mais 2 músicas na fila');
    const queue = await ana.say('/queue');
    expect(queue).toContain('1. **Lista 2**');
    expect(queue).toContain('2. **Lista 3**');
    expect(await ana.say('/play https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M')).toMatch(/2 músicas adicionadas/);
    await ana.say('/stop');
  }, 30_000);

  it('explica os erros em vez de ficar mudo', async () => {
    const ana = await person('Ana');
    expect(await ana.say('/play erro')).toContain('Não achei nada');
    expect(await ana.say('/play https://exemplo.com/musica.mp3')).toContain('Só links do YouTube e do Spotify');
    expect(await ana.say('/play')).toContain('Diga o que tocar');
    expect(await ana.say('/skip')).toContain('Não estou tocando nada');

    // Uma música que falha ao abrir avisa o motivo e a fila segue.
    const failure = nextEvent(
      ana.client.socket,
      'message:new',
      (m) => m.authorId === ana.botId && m.content.includes('Não consegui tocar'),
      8_000,
    );
    await ana.send('/play quebrada');
    expect((await failure).content).toContain('Esse vídeo é privado');
    await ana.say('/stop');
  }, 30_000);

  it('só obedece quem está em um canal de voz, e só quem está na sala do bot controla', async () => {
    const fora = await person('Fora', { inVoice: false });
    expect(await fora.say('/play oi')).toContain('Entre em um canal de voz');
    expect(await fora.say('/help')).toContain('Comandos do Coreto Música');

    const ana = await person('Ana');
    await ana.say('/play toco');
    const outra = await person('Carla', { inVoice: false });
    const pareamento = channelNamed(await joinDemoSpace(outra.client), 'Pareamento').id;
    ok(await outra.client.socket.emitWithAck('voice:join', { channelId: pareamento }));
    expect(await outra.say('/play invasora')).toContain('Já estou tocando em #Sala de estar');
    expect(await outra.say('/skip')).toContain('Só quem está no canal de voz');
    await ana.say('/stop');
  }, 40_000);

  it('o bot não responde a mensagens comuns nem a comandos que não conhece', async () => {
    const ana = await person('Ana');
    const quiet = nextEvent(ana.client.socket, 'message:new', (m) => m.authorId === ana.botId, 1_200).then(
      () => 'respondeu',
      () => 'calado',
    );
    await ana.send('oi pessoal, bora jogar?');
    await ana.send('/shrug');
    expect(await quiet).toBe('calado');
  }, 15_000);
});
