// Configuração do bot de música, lida das variáveis de ambiente.
//
//   MUSIC_ENABLED          "false" desliga o bot (padrão: liga, se o yt-dlp e o ffmpeg existirem)
//   YTDLP_PATH             caminho do yt-dlp (padrão: "yt-dlp" no PATH)
//   FFMPEG_PATH            caminho do ffmpeg (padrão: "ffmpeg" no PATH)
//   YTDLP_COOKIES_FILE     arquivo cookies.txt de uma conta do YouTube, para quando o YouTube bloqueia o servidor
//   YTDLP_JS_RUNTIMES      runtime de JavaScript que o yt-dlp usa para o YouTube (padrão: "node")
//   MUSIC_MAX_QUEUE        músicas esperando na fila (padrão: 50)
//   MUSIC_MAX_PLAYLIST     músicas aceitas de uma playlist por pedido (padrão: 25)
//   MUSIC_MAX_MINUTES      duração máxima de uma música (padrão: 180)
//   MUSIC_IDLE_SECONDS     sem ninguém ouvindo e sem fila, o bot sai da chamada depois disso (padrão: 120)

export interface MusicConfig {
  enabled: boolean;
  ytdlpPath: string;
  ffmpegPath: string;
  cookiesFile: string | null;
  jsRuntimes: string;
  maxQueue: number;
  maxPlaylistTracks: number;
  maxTrackSeconds: number;
  idleSeconds: number;
}

function positive(raw: string | undefined, fallback: number, name: string): number {
  if (raw === undefined || raw === '') return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) throw new Error(`${name} precisa ser um número positivo.`);
  return value;
}

export function musicConfigFromEnv(env: NodeJS.ProcessEnv = process.env): MusicConfig {
  return {
    enabled: env.MUSIC_ENABLED !== 'false',
    ytdlpPath: env.YTDLP_PATH || 'yt-dlp',
    ffmpegPath: env.FFMPEG_PATH || 'ffmpeg',
    cookiesFile: env.YTDLP_COOKIES_FILE || null,
    jsRuntimes: env.YTDLP_JS_RUNTIMES || 'node',
    maxQueue: positive(env.MUSIC_MAX_QUEUE, 50, 'MUSIC_MAX_QUEUE'),
    maxPlaylistTracks: positive(env.MUSIC_MAX_PLAYLIST, 25, 'MUSIC_MAX_PLAYLIST'),
    maxTrackSeconds: positive(env.MUSIC_MAX_MINUTES, 180, 'MUSIC_MAX_MINUTES') * 60,
    idleSeconds: positive(env.MUSIC_IDLE_SECONDS, 120, 'MUSIC_IDLE_SECONDS'),
  };
}
