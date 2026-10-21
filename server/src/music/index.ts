// Liga o bot de música ao servidor. Se faltar algo (yt-dlp, ffmpeg, o WebRTC nativo), o Coreto sobe
// normalmente e só o bot fica de fora, com o motivo no log.

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { Store } from '../store.js';
import type { IceConfig } from '../turn.js';
import type { IO } from '../realtime/types.js';
import { joinPublicSpaces } from '../realtime/membership.js';
import { loadWrtc } from './bot-voice.js';
import { BOT_COLOR, BOT_NAME, MusicBot } from './bot.js';
import type { MusicConfig } from './config.js';
import type { MusicSource } from './source.js';
import { YtDlpSource } from './ytdlp-source.js';

export { musicConfigFromEnv, type MusicConfig } from './config.js';
export { MusicBot } from './bot.js';

export type MusicFactory = (context: { io: IO; store: Store; ice: IceConfig }) => Promise<MusicBot | null>;

const run = promisify(execFile);

/** O programa responde a `--version`? */
async function works(command: string, args: string[]): Promise<boolean> {
  try {
    await run(command, args, { timeout: 15_000, windowsHide: true });
    return true;
  } catch {
    return false;
  }
}

/**
 * Cria o bot com o yt-dlp e o ffmpeg reais. Em testes, passe `source` para trocar o áudio por um
 * gerador de tom (e `checkTools: false`, para não exigir os programas instalados).
 */
export function createMusic(config: MusicConfig, options: { source?: MusicSource; checkTools?: boolean } = {}): MusicFactory {
  return async ({ io, store, ice }) => {
    if (!config.enabled) return null;
    if (options.checkTools !== false) {
      const [ytdlp, ffmpeg] = await Promise.all([works(config.ytdlpPath, ['--version']), works(config.ffmpegPath, ['-version'])]);
      if (!ytdlp || !ffmpeg) {
        console.warn(`Coreto: bot de música desligado (não encontrei ${[!ytdlp && 'yt-dlp', !ffmpeg && 'ffmpeg'].filter(Boolean).join(' nem ')}).`);
        return null;
      }
    }
    let wrtc;
    try {
      wrtc = await loadWrtc();
    } catch (err) {
      console.warn('Coreto: bot de música desligado (o WebRTC nativo não carregou neste sistema).', err);
      return null;
    }
    const user = await store.ensureBot(BOT_NAME, BOT_COLOR);
    // Todo espaço é público: o robô é membro de todos, para o nome e o avatar dele aparecerem na lista da sala.
    await joinPublicSpaces(io, store, user.id);
    const bot = new MusicBot({ io, store, ice, config, wrtc, userId: user.id, source: options.source ?? new YtDlpSource(config) });
    console.log(`Coreto: bot de música ligado (${BOT_NAME}).`);
    return bot;
  };
}
