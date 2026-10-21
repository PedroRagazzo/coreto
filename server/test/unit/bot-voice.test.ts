import { afterEach, describe, expect, it } from 'vitest';
import type { SignalPayload } from '../../../shared/src/protocol.js';
import { BotVoice, loadWrtc } from '../../src/music/bot-voice.js';
import { makeHuman, type Human } from '../support/voice-peer.js';

const BOT = 'bot-musica';
const HUMAN = 'zz-humano';

/** 10 ms de um tom de 440 Hz, contínuo entre os quadros. */
function toneFrames() {
  let t = 0;
  return () => {
    const samples = new Int16Array(480);
    for (let i = 0; i < samples.length; i++) samples[i] = Math.round(8000 * Math.sin((2 * Math.PI * 440 * t++) / 48000));
    return samples;
  };
}

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function until(check: () => boolean, ms = 8000): Promise<void> {
  const deadline = Date.now() + ms;
  while (!check()) {
    if (Date.now() > deadline) throw new Error('tempo esgotado esperando o áudio chegar');
    await wait(50);
  }
}

describe('BotVoice (WebRTC do bot de música)', () => {
  const cleanup: (() => void)[] = [];
  afterEach(() => {
    for (const fn of cleanup.splice(0)) fn();
  });

  async function setup() {
    const wrtc = await loadWrtc();
    let human: Human;
    const bot = new BotVoice({
      wrtc,
      botId: BOT,
      iceServers: [],
      iceTransportPolicy: 'all',
      sendSignal: (_to, signal) => human.receive(signal),
    });
    human = makeHuman(wrtc, { selfId: HUMAN, botId: BOT }, (signal) => bot.handleSignal(HUMAN, signal));
    cleanup.push(() => human.close(), () => bot.close());
    const next = toneFrames();
    const timer = setInterval(() => bot.pushFrame(next()), 10);
    cleanup.push(() => clearInterval(timer));
    return { bot, human };
  }

  it('liga para quem já está na sala e o áudio chega', async () => {
    const { bot, human } = await setup();
    bot.join([HUMAN]);
    await until(() => human.stats().frames > 50);
    const { peak, sampleRate } = human.stats();
    expect(sampleRate).toBe(48000);
    expect(peak).toBeGreaterThan(4000); // o tom de 440 Hz passou pelo Opus
  }, 15_000);

  it('atende quem liga depois (quem chega na sala liga para o bot)', async () => {
    const { bot, human } = await setup();
    human.callBot();
    await until(() => human.stats().frames > 50);
    expect(human.stats().peak).toBeGreaterThan(4000);
    expect(bot.peerCount).toBe(1);
  }, 15_000);

  it('fecha a conexão de quem saiu e para de enviar', async () => {
    const { bot, human } = await setup();
    bot.join([HUMAN]);
    await until(() => human.stats().frames > 20);
    bot.closePeer(HUMAN);
    expect(bot.peerCount).toBe(0);
    const before = human.stats().frames;
    await wait(300);
    // Sem conexão, o bot não manda mais nada (pode chegar o que já estava no caminho).
    expect(human.stats().frames - before).toBeLessThan(40);
  }, 15_000);
});
