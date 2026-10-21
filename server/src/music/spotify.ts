// Lê músicas, álbuns e playlists do Spotify sem chave de API: o Spotify não entrega áudio (é protegido),
// só o que a página de incorporação ("embed") mostra a qualquer visitante: nomes, artistas e duração.
// Quem toca é o YouTube, procurando "artista título". A página pode mudar sem aviso; se mudar, o bot
// responde que não conseguiu ler o link em vez de tocar a coisa errada.

import { MusicError } from './source.js';

export interface SpotifyTrack {
  title: string;
  artist: string | null;
  durationSeconds: number | null;
}

export interface SpotifyCollection {
  name: string;
  tracks: SpotifyTrack[];
}

type Fetch = (url: string, init?: { headers?: Record<string, string>; signal?: AbortSignal }) => Promise<{ ok: boolean; status: number; text(): Promise<string> }>;

const MAX_PAGE_BYTES = 2_000_000;

export async function readSpotify(
  type: 'track' | 'album' | 'playlist',
  id: string,
  fetchPage: Fetch = fetch as unknown as Fetch,
): Promise<SpotifyCollection> {
  let html: string;
  try {
    const res = await fetchPage(`https://open.spotify.com/embed/${type}/${id}`, {
      headers: { 'user-agent': 'Mozilla/5.0 (compatible; Coreto)' },
      signal: AbortSignal.timeout(12_000),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    html = (await res.text()).slice(0, MAX_PAGE_BYTES);
  } catch {
    throw new MusicError('Não consegui abrir esse link do Spotify. Confira se ele é público.');
  }
  const parsed = parseEmbed(html, type);
  if (!parsed) throw new MusicError('Não consegui ler esse link do Spotify. Tente o link do YouTube ou o nome da música.');
  return parsed;
}

/** Extrai o que interessa do JSON que a página de incorporação traz (`__NEXT_DATA__`). */
export function parseEmbed(html: string, type: 'track' | 'album' | 'playlist'): SpotifyCollection | null {
  const raw = /<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/.exec(html)?.[1];
  if (!raw) return null;
  let entity: Record<string, unknown> | undefined;
  try {
    entity = (JSON.parse(raw) as { props?: { pageProps?: { state?: { data?: { entity?: Record<string, unknown> } } } } }).props?.pageProps?.state?.data?.entity;
  } catch {
    return null;
  }
  if (!entity || typeof entity.name !== 'string') return null;

  if (type === 'track') {
    const artists = Array.isArray(entity.artists) ? entity.artists.map((a) => (a as { name?: unknown }).name).filter((n): n is string => typeof n === 'string') : [];
    return { name: entity.name, tracks: [{ title: entity.name, artist: artists.join(', ') || null, durationSeconds: seconds(entity.duration) }] };
  }
  if (!Array.isArray(entity.trackList)) return null;
  const tracks = entity.trackList.flatMap((item): SpotifyTrack[] => {
    const t = item as { title?: unknown; subtitle?: unknown; duration?: unknown; isPlayable?: unknown };
    if (typeof t.title !== 'string' || !t.title) return [];
    // O Spotify separa artistas com uma vírgula e um espaço sem quebra.
    const artist = typeof t.subtitle === 'string' ? t.subtitle.replace(/ /g, ' ').trim() : '';
    return [{ title: t.title, artist: artist || null, durationSeconds: seconds(t.duration) }];
  });
  return tracks.length > 0 ? { name: entity.name, tracks } : null;
}

const seconds = (ms: unknown) => (typeof ms === 'number' && ms > 0 ? Math.round(ms / 1000) : null);
