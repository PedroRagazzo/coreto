// O áudio vem do YouTube pelo yt-dlp e é convertido pelo ffmpeg para PCM de 48 kHz. Os programas são
// chamados sem shell e só com argumentos montados aqui: ids validados (links.ts) ou o prefixo
// "ytsearch1:" seguido de uma busca, então o texto de ninguém vira opção de linha de comando.

import { execFile, spawn } from 'node:child_process';
import { Transform } from 'node:stream';
import type { MusicConfig } from './config.js';
import { CookieJar } from './cookies.js';
import { youtubePlaylistUrl, youtubeVideoUrl, type MusicRequest } from './links.js';
import type { NewTrack, Track } from './queue.js';
import { MusicError, type AudioHandle, type MusicSource } from './source.js';
import { readSpotify, type SpotifyCollection } from './spotify.js';

const MAX_JSON_BYTES = 30 * 1024 * 1024;
const RESOLVE_TIMEOUT_MS = 60_000;
/** Se o ffmpeg não entregar nada nesse tempo, a música é abandonada. */
const FIRST_AUDIO_TIMEOUT_MS = 40_000;
const VIDEO_ID = /^[\w-]{11}$/;

interface YtInfo {
  id?: string;
  title?: string;
  uploader?: string;
  channel?: string;
  duration?: number | null;
  is_live?: boolean;
  live_status?: string;
  entries?: YtInfo[];
}

/** Traduz a saída de erro do yt-dlp para algo que o chat entenda. */
export function explainYtDlpError(stderr: string, hasCookies = false): string {
  const text = stderr.toLowerCase();
  if (text.includes('not a bot') || text.includes('sign in to confirm')) {
    return hasCookies
      ? 'O YouTube recusou os cookies configurados (podem ter expirado). Quem administra o Coreto precisa exportar o cookies.txt de novo.'
      : 'O YouTube bloqueou este servidor (pediu para confirmar que não sou um robô). Quem administra o Coreto precisa configurar os cookies do YouTube (YTDLP_COOKIES_FILE).';
  }
  if (text.includes('private video')) return 'Esse vídeo é privado.';
  if (text.includes('age') && text.includes('restricted')) return 'Esse vídeo tem restrição de idade.';
  if (text.includes('video unavailable') || text.includes('not available') || text.includes('has been removed')) {
    return 'Esse vídeo não está disponível (removido ou bloqueado na região do servidor).';
  }
  if (text.includes('copyright')) return 'Esse vídeo foi bloqueado por direitos autorais.';
  if (text.includes('premieres in') || text.includes('live event will begin')) return 'Esse vídeo ainda não estreou.';
  const last = stderr.trim().split('\n').filter(Boolean).pop() ?? '';
  return last ? `Não consegui carregar: ${last.replace(/^ERROR:\s*/i, '').slice(0, 160)}` : 'Não consegui carregar esse áudio.';
}

export class YtDlpSource implements MusicSource {
  private readonly cookies: CookieJar;

  constructor(
    private readonly config: MusicConfig,
    private readonly spotify: typeof readSpotify = readSpotify,
  ) {
    this.cookies = new CookieJar(config.cookiesFile);
  }

  private baseArgs(): string[] {
    return [
      '--ignore-config',
      '--no-warnings',
      '--no-progress',
      '--socket-timeout',
      '20',
      '--retries',
      '3',
      '--js-runtimes',
      this.config.jsRuntimes,
      ...this.cookieArgs(),
      ...this.config.extraArgs,
    ];
  }

  private cookieArgs(): string[] {
    const path = this.cookies.path();
    return path ? ['--cookies', path] : [];
  }

  private json(args: string[]): Promise<YtInfo> {
    return new Promise((resolve, reject) => {
      execFile(
        this.config.ytdlpPath,
        [...this.baseArgs(), '-J', ...args],
        { maxBuffer: MAX_JSON_BYTES, timeout: RESOLVE_TIMEOUT_MS, windowsHide: true },
        (err, stdout, stderr) => {
          if (err) return reject(new MusicError(explainYtDlpError(String(stderr) || err.message, this.cookies.path() !== null)));
          try {
            resolve(JSON.parse(stdout) as YtInfo);
          } catch {
            reject(new MusicError('Resposta inesperada do yt-dlp.'));
          }
        },
      );
    });
  }

  async resolve(request: MusicRequest, requestedBy: string, limit: number): Promise<NewTrack[]> {
    switch (request.kind) {
      case 'youtube-video': {
        const info = await this.json(['--no-playlist', youtubeVideoUrl(request.id)]);
        return [this.fromInfo({ ...info, id: info.id ?? request.id }, requestedBy)];
      }
      case 'youtube-playlist': {
        const info = await this.json(['--flat-playlist', '--playlist-end', String(limit), youtubePlaylistUrl(request.id)]);
        const tracks = (info.entries ?? []).flatMap((entry) => this.tryFromInfo(entry, requestedBy));
        if (tracks.length === 0) throw new MusicError('Não achei músicas tocáveis nessa playlist.');
        return tracks.slice(0, limit);
      }
      case 'search': {
        const info = await this.json(['--flat-playlist', '--playlist-end', '1', `ytsearch1:${request.query}`]);
        const [first] = (info.entries ?? []).flatMap((entry) => this.tryFromInfo(entry, requestedBy));
        if (!first) throw new MusicError(`Não achei nada para "${request.query.slice(0, 60)}".`);
        return [first];
      }
      case 'spotify': {
        const collection: SpotifyCollection = await this.spotify(request.type, request.id);
        return collection.tracks.slice(0, limit).map((t) => ({
          requestedBy,
          title: t.title,
          artist: t.artist,
          durationSeconds: t.durationSeconds,
          source: `ytsearch1:${[t.artist, t.title].filter(Boolean).join(' ')}`.slice(0, 300),
        }));
      }
    }
  }

  /** Uma música do YouTube; recusa transmissões ao vivo e músicas longas demais. */
  private fromInfo(info: YtInfo, requestedBy: string): NewTrack {
    if (!info.id || !VIDEO_ID.test(info.id)) throw new MusicError('Não consegui identificar esse vídeo.');
    if (info.is_live || info.live_status === 'is_live') throw new MusicError('Transmissões ao vivo não são suportadas.');
    const duration = typeof info.duration === 'number' && info.duration > 0 ? Math.round(info.duration) : null;
    if (duration !== null && duration > this.config.maxTrackSeconds) {
      throw new MusicError(`Essa música passa do limite de ${Math.round(this.config.maxTrackSeconds / 60)} minutos.`);
    }
    return {
      requestedBy,
      title: (info.title ?? 'Sem título').slice(0, 200),
      artist: (info.channel ?? info.uploader ?? null)?.slice(0, 100) ?? null,
      durationSeconds: duration,
      source: youtubeVideoUrl(info.id),
    };
  }

  /** Em listas, o que não dá para tocar (privado, apagado, ao vivo, longo) é pulado em silêncio. */
  private tryFromInfo(info: YtInfo, requestedBy: string): NewTrack[] {
    if (!info.title || /^\[(private|deleted) video\]$/i.test(info.title)) return [];
    try {
      return [this.fromInfo(info, requestedBy)];
    } catch {
      return [];
    }
  }

  open(track: Track): AudioHandle {
    const ytdlp = spawn(this.config.ytdlpPath, [...this.baseArgs(), '-f', 'bestaudio/best', '--no-playlist', '-o', '-', track.source], {
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
    const ffmpeg = spawn(
      this.config.ffmpegPath,
      ['-hide_banner', '-loglevel', 'error', '-nostdin', '-i', 'pipe:0', '-vn', '-f', 's16le', '-acodec', 'pcm_s16le', '-ar', '48000', '-ac', '1', 'pipe:1'],
      { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true },
    );
    ytdlp.stdout.pipe(ffmpeg.stdin);
    // Ao parar no meio, o ffmpeg fecha a entrada e o yt-dlp reclama de pipe quebrado: é esperado.
    ffmpeg.stdin.on('error', () => {});
    ytdlp.stdout.on('error', () => {});

    let bytes = 0;
    const pcm = new Transform({
      transform(chunk: Buffer, _encoding, done) {
        bytes += chunk.length;
        done(null, chunk);
      },
    });
    ffmpeg.stdout.pipe(pcm);

    let ytdlpErrors = '';
    let ffmpegErrors = '';
    ytdlp.stderr.on('data', (d: Buffer) => (ytdlpErrors = (ytdlpErrors + d).slice(-4000)));
    ffmpeg.stderr.on('data', (d: Buffer) => (ffmpegErrors = (ffmpegErrors + d).slice(-2000)));

    const hasCookies = this.cookies.path() !== null;
    let stopped = false;
    let timedOut = false;
    const stop = () => {
      stopped = true;
      ytdlp.kill();
      ffmpeg.kill();
    };
    const watchdog = setTimeout(() => {
      if (bytes === 0) {
        timedOut = true;
        stop();
      }
    }, FIRST_AUDIO_TIMEOUT_MS);

    const finished = new Promise<{ bytes: number; error: string | null }>((resolve) => {
      let ytdlpCode: number | null | undefined;
      let ffmpegDone = false;
      const settle = () => {
        if (!ffmpegDone || ytdlpCode === undefined) return;
        clearTimeout(watchdog);
        if (stopped && !timedOut) return resolve({ bytes, error: null });
        if (timedOut) return resolve({ bytes, error: 'O áudio demorou demais para começar.' });
        if (ytdlpCode !== 0 || bytes === 0) {
          return resolve({ bytes, error: explainYtDlpError(ytdlpErrors || ffmpegErrors, hasCookies) });
        }
        resolve({ bytes, error: null });
      };
      ytdlp.on('close', (code) => {
        ytdlpCode = code;
        settle();
      });
      ytdlp.on('error', () => {
        ytdlpErrors ||= 'Não consegui executar o yt-dlp neste servidor.';
        ytdlpCode = 127;
        settle();
      });
      ffmpeg.on('close', () => {
        ffmpegDone = true;
        pcm.end();
        settle();
      });
      ffmpeg.on('error', () => {
        ffmpegErrors ||= 'Não consegui executar o ffmpeg neste servidor.';
        ffmpegDone = true;
        pcm.end();
        settle();
      });
    });

    return { pcm, stop, finished };
  }
}
