// Entende o que a pessoa pediu ao bot de música: um link do YouTube, um link do Spotify ou uma busca.
// Nada do texto digitado vai direto para o yt-dlp: só ids validados e buscas viram argumentos, então
// links de outros sites (ou "file://...") nunca chegam ao programa.

export type MusicRequest =
  | { kind: 'youtube-video'; id: string }
  | { kind: 'youtube-playlist'; id: string }
  | { kind: 'spotify'; type: 'track' | 'album' | 'playlist'; id: string }
  | { kind: 'search'; query: string };

export type ParsedRequest = MusicRequest | { kind: 'invalid'; reason: string };

export const MAX_QUERY_LENGTH = 200;

const YOUTUBE_HOSTS = new Set(['youtube.com', 'www.youtube.com', 'm.youtube.com', 'music.youtube.com', 'youtu.be', 'www.youtu.be']);
const VIDEO_ID = /^[\w-]{11}$/;
const PLAYLIST_ID = /^[\w-]{10,64}$/;
const SPOTIFY_ID = /^[A-Za-z0-9]{22}$/;

export function parseMusicRequest(raw: string): ParsedRequest {
  const text = raw.trim();
  if (!text) return { kind: 'invalid', reason: 'Diga o que tocar: um link do YouTube ou do Spotify, ou o nome da música.' };

  const uri = /^spotify:(track|album|playlist):([A-Za-z0-9]{22})$/.exec(text);
  if (uri) return { kind: 'spotify', type: uri[1] as 'track' | 'album' | 'playlist', id: uri[2] };

  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(text)) return parseUrl(text);
  // "youtube.com/watch?v=..." sem o https.
  if (/^(www\.|m\.|music\.)?(youtube\.com|youtu\.be|open\.spotify\.com)\//i.test(text)) return parseUrl(`https://${text}`);

  const query = text.replace(/\s+/g, ' ');
  if (query.length > MAX_QUERY_LENGTH) return { kind: 'invalid', reason: `A busca passa de ${MAX_QUERY_LENGTH} caracteres.` };
  return { kind: 'search', query };
}

function parseUrl(text: string): ParsedRequest {
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    return { kind: 'invalid', reason: 'Esse link não parece válido.' };
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    return { kind: 'invalid', reason: 'Só links do YouTube e do Spotify.' };
  }
  const host = url.hostname.toLowerCase();
  if (YOUTUBE_HOSTS.has(host)) return parseYoutube(url, host);
  if (host === 'open.spotify.com') return parseSpotify(url);
  return { kind: 'invalid', reason: 'Só links do YouTube e do Spotify.' };
}

function parseYoutube(url: URL, host: string): ParsedRequest {
  const segments = url.pathname.split('/').filter(Boolean);
  const list = url.searchParams.get('list');

  let video: string | null = null;
  if (host.endsWith('youtu.be')) video = segments[0] ?? null;
  else if (segments[0] === 'watch') video = url.searchParams.get('v');
  else if (['shorts', 'live', 'embed', 'v'].includes(segments[0])) video = segments[1] ?? null;

  if (video !== null) {
    return VIDEO_ID.test(video) ? { kind: 'youtube-video', id: video } : { kind: 'invalid', reason: 'Esse link do YouTube não tem um vídeo válido.' };
  }
  if (segments[0] === 'playlist' && list) {
    return PLAYLIST_ID.test(list) ? { kind: 'youtube-playlist', id: list } : { kind: 'invalid', reason: 'Essa playlist do YouTube não é válida.' };
  }
  return { kind: 'invalid', reason: 'Esse link do YouTube não é de um vídeo nem de uma playlist.' };
}

function parseSpotify(url: URL): ParsedRequest {
  // /track/ID, /album/ID, /playlist/ID; links antigos trazem um prefixo de idioma ("intl-pt").
  const segments = url.pathname.split('/').filter(Boolean);
  if (segments[0]?.startsWith('intl-')) segments.shift();
  const [type, id] = segments;
  if (type === 'track' || type === 'album' || type === 'playlist') {
    return SPOTIFY_ID.test(id ?? '') ? { kind: 'spotify', type, id } : { kind: 'invalid', reason: 'Esse link do Spotify não é válido.' };
  }
  return { kind: 'invalid', reason: 'Do Spotify, só links de música, álbum e playlist.' };
}

/** `https://www.youtube.com/watch?v=...`, montado só a partir do id já validado. */
export const youtubeVideoUrl = (id: string) => `https://www.youtube.com/watch?v=${id}`;
export const youtubePlaylistUrl = (id: string) => `https://www.youtube.com/playlist?list=${id}`;
