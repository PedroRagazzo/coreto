import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { Message, VoiceParticipant } from '../../../shared/src/models.js';
import type { MusicControl, MusicState } from '../../../shared/src/protocol.js';
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

  it('toca a seguir (na frente da fila) e embaralha a fila', async () => {
    const ana = await person('Ana');
    await ana.say('/play um');
    await ana.say('/play dois');
    await ana.say('/play tres');
    expect(await ana.say('/playnext quatro')).toMatch(/Toca a seguir:.*quatro/);

    const queue = await ana.say('/fila');
    expect(queue).toContain('1. **quatro**');
    expect(queue).toContain('2. **dois**');
    expect(queue).toContain('3. **tres**');

    expect(await ana.say('/shuffle')).toContain('Embaralhei as 3 músicas');
    const shuffled = await ana.say('/fila');
    for (const title of ['dois', 'tres', 'quatro']) expect(shuffled).toContain(`**${title}**`);
    expect(shuffled).toContain('Tocando: **um**');

    await ana.say('/clear');
    expect(await ana.say('/shuffle')).toContain('pelo menos duas');
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

  describe('painel da sala', () => {
    const state = (p: Person, check: (s: MusicState | null) => boolean = () => true, ms = 8_000) =>
      nextEvent(p.client.socket, 'music:state', check, ms);
    const play = async (p: Person, input: string) => ok(await p.client.socket.emitWithAck('music:play', { input }));
    const control = (p: Person, request: MusicControl) => p.client.socket.emitWithAck('music:control', request);

    it('pede música, mostra o que toca e a fila, e controla tudo sem usar o chat', async () => {
      const ana = await person('Ana');
      const chatReplies: string[] = [];
      ana.client.socket.on('message:new', (m: Message) => m.authorId === ana.botId && chatReplies.push(m.content));

      let playing = state(ana, (s) => s?.current?.title === 'luar');
      const first = await play(ana, 'luar');
      expect(first.message).toContain('Tocando');
      const s1 = (await playing)!;
      expect(s1).toMatchObject({ paused: false, volume: 100, queue: [], notice: null });
      expect(s1.current).toMatchObject({ title: 'luar', artist: 'Banda de Teste', requestedBy: expect.stringContaining('Ana') });

      // Segunda música: entra na fila com id.
      const queued = state(ana, (s) => (s?.queue.length ?? 0) === 1);
      expect((await play(ana, 'dois')).message).toContain('Na fila');
      const s2 = (await queued)!;
      expect(s2.queue[0]).toMatchObject({ title: 'dois' });
      expect(s2.queue[0].id).toBeTruthy();

      // Volume, pausa (com a posição andando) e retomada.
      let next = state(ana, (s) => s?.volume === 40);
      ok(await control(ana, { action: 'volume', volume: 40 }));
      await next;
      await wait(1200);
      next = state(ana, (s) => s?.paused === true);
      ok(await control(ana, { action: 'pause' }));
      const paused = (await next)!;
      expect(paused.current!.positionMs).toBeGreaterThan(800);
      next = state(ana, (s) => s?.paused === false);
      ok(await control(ana, { action: 'resume' }));
      await next;

      // Tirar da fila e esvaziar.
      next = state(ana, (s) => s?.queue.length === 0);
      ok(await control(ana, { action: 'remove', id: s2.queue[0].id }));
      await next;
      expect(await control(ana, { action: 'remove', id: s2.queue[0].id })).toEqual({ ok: false, error: 'Essa música já saiu da fila.' });
      await play(ana, 'tres');
      next = state(ana, (s) => s?.queue.length === 0 && s?.current?.title === 'luar');
      ok(await control(ana, { action: 'clear' }));
      await next;

      // Pular sem fila: a música acaba e o painel mostra a sala parada.
      next = state(ana, (s) => s !== null && s.current === null);
      ok(await control(ana, { action: 'skip' }));
      await next;

      // Parar: o bot sai e o painel recebe `null`.
      const left = state(ana, (s) => s === null);
      await play(ana, 'quatro');
      ok(await control(ana, { action: 'stop' }));
      await left;

      // Nada disso falou no chat: o painel não tem canal de texto.
      expect(chatReplies).toEqual([]);
    }, 40_000);

    it('toca a seguir e embaralha pelo painel', async () => {
      const ana = await person('Ana');
      await play(ana, 'luar');
      const full = state(ana, (s) => s?.queue.length === 3);
      for (const title of ['dois', 'tres', 'quatro']) await play(ana, title);

      // Uma música que já espera passa para a frente.
      const before = (await full)!;
      const four = before.queue.find((t) => t.title === 'quatro')!;
      let next = state(ana, (s) => s?.queue[0]?.title === 'quatro');
      ok(await control(ana, { action: 'top', id: four.id }));
      expect((await next)!.queue.map((t) => t.title).sort()).toEqual(['dois', 'quatro', 'tres']);
      expect(await control(ana, { action: 'top', id: 'nao-existe' })).toEqual({ ok: false, error: 'Essa música já saiu da fila.' });

      // Um pedido novo com `next` entra na frente.
      next = state(ana, (s) => s?.queue[0]?.title === 'cinco');
      ok(await ana.client.socket.emitWithAck('music:play', { input: 'cinco', next: true }));
      expect((await next)!.queue).toHaveLength(4);

      // Embaralhar mantém as mesmas músicas e o que está tocando.
      next = state(ana, (s) => s?.queue.length === 4);
      ok(await control(ana, { action: 'shuffle' }));
      const shuffled = (await next)!;
      expect(shuffled.queue.map((t) => t.title).sort()).toEqual(['cinco', 'dois', 'quatro', 'tres']);
      expect(shuffled.current?.title).toBe('luar');

      ok(await control(ana, { action: 'stop' }));
    }, 40_000);

    it('quem entra na sala com o bot tocando já recebe o estado', async () => {
      const ana = await person('Ana');
      await play(ana, 'cancao');
      const bruno = await person('Bruno', { inVoice: false });
      const got = state(bruno, (s) => s?.current?.title === 'cancao');
      ok(await bruno.client.socket.emitWithAck('voice:join', { channelId: bruno.voice }));
      expect((await got)!.channelId).toBe(bruno.voice);
      ok(await control(ana, { action: 'stop' }));
    }, 30_000);

    it('avisa no painel quando uma música não toca', async () => {
      const ana = await person('Ana');
      const failed = state(ana, (s) => Boolean(s?.notice));
      await play(ana, 'quebrada');
      expect((await failed)!.notice).toContain('Esse vídeo é privado');
      ok(await control(ana, { action: 'stop' }));
    }, 30_000);

    it('recusa quem não está em voz, quem está em outra sala e pedidos malformados', async () => {
      const fora = await person('Fora', { inVoice: false });
      expect(await fora.client.socket.emitWithAck('music:play', { input: 'oi' })).toEqual({
        ok: false,
        error: 'Entre em um canal de voz antes de usar os comandos de música.',
      });
      expect((await control(fora, { action: 'skip' })).ok).toBe(false);

      const ana = await person('Ana');
      await play(ana, 'toco');
      const outra = await person('Carla', { inVoice: false });
      const pareamento = channelNamed(await joinDemoSpace(outra.client), 'Pareamento').id;
      ok(await outra.client.socket.emitWithAck('voice:join', { channelId: pareamento }));
      const refused = await control(outra, { action: 'skip' });
      expect(refused.ok).toBe(false);
      expect(refused.ok === false && refused.error).toContain('Só quem está no canal de voz');

      const invalid = await ana.client.socket.emitWithAck('music:control', { action: 'explodir' } as never);
      expect(invalid).toEqual({ ok: false, error: 'Pedido inválido.' });
      expect(await ana.client.socket.emitWithAck('music:play', { input: 'https://exemplo.com/x.mp3' })).toEqual({
        ok: false,
        error: 'Só links do YouTube e do Spotify.',
      });
      ok(await control(ana, { action: 'stop' }));
    }, 40_000);
  });
});
