// Pré-visualização de links. O servidor busca a página (safe-fetch.ts), lê o que ela diz sobre si mesma (html.ts) e
// guarda o resultado na memória por um tempo, para o mesmo link numa conversa movimentada não virar uma enxurrada de
// visitas. A imagem de destaque nunca é carregada direto do site pelo navegador de quem lê (isso mostraria o IP de
// todo mundo ao dono do site e a política de segurança do Coreto não deixa): o servidor a busca e entrega pelo
// endereço /embed-image/<id>, com o tipo conferido pelos bytes e um tamanho máximo.

import { randomUUID } from 'node:crypto';
import type { LinkPreview } from '../../../shared/src/models.js';
import { decodeHtml, parsePage } from './html.js';
import { sniffImage, type RasterType } from './image-size.js';
import { safeGet, UnsafeUrlError } from './safe-fetch.js';

const HTML_LIMIT = 512 * 1024;
const SNIFF_LIMIT = 64 * 1024;
const IMAGE_LIMIT = 4 * 1024 * 1024;
const OEMBED_LIMIT = 32 * 1024;
const TTL_MS = 60 * 60_000;
const MISS_TTL_MS = 10 * 60_000;
const MAX_PREVIEWS = 500;
const MAX_IMAGES = 1000;
/** Soma dos bytes das imagens guardadas na memória. */
const IMAGE_CACHE_BYTES = 32 * 1024 * 1024;
const MAX_PARALLEL = 6;

const YOUTUBE = /^(www\.|m\.|music\.)?(youtube\.com|youtu\.be)$/i;

export interface EmbedServiceOptions {
  /** Só para testes: deixa buscar endereços da rede interna. */
  allowPrivate?: boolean;
  now?: () => number;
}

export interface EmbedService {
  /** A pré-visualização do link, ou `null` se a página não tem o que mostrar (ou não deu para buscar). */
  preview(url: string): Promise<LinkPreview | null>;
  /** O arquivo de uma imagem de pré-visualização, pelo id que veio em `preview`. */
  image(id: string): Promise<{ type: RasterType; body: Buffer } | null>;
}

const typeOf = (headers: { 'content-type'?: string }) => (headers['content-type'] ?? '').split(';')[0].trim().toLowerCase();
const isImageType = (type: string) => /^image\/(png|jpe?g|gif|webp)$/.test(type);
const isHtmlType = (type: string) => type === 'text/html' || type === 'application/xhtml+xml';

export function createEmbeds({ allowPrivate = false, now = Date.now }: EmbedServiceOptions = {}): EmbedService {
  const previews = new Map<string, { at: number; value: LinkPreview | null }>();
  const pending = new Map<string, Promise<LinkPreview | null>>();
  const images = new Map<string, string>(); // id → endereço da imagem
  const bodies = new Map<string, { type: RasterType; body: Buffer }>();
  let bodyBytes = 0;
  let running = 0;
  const waiting: (() => void)[] = [];

  /** No máximo `MAX_PARALLEL` buscas ao mesmo tempo; as outras esperam a vez. */
  async function slot<T>(work: () => Promise<T>): Promise<T> {
    if (running >= MAX_PARALLEL) await new Promise<void>((resolve) => waiting.push(resolve));
    running++;
    try {
      return await work();
    } finally {
      running--;
      waiting.shift()?.();
    }
  }

  const trim = <K, V>(map: Map<K, V>, max: number) => {
    while (map.size > max) map.delete(map.keys().next().value as K);
  };

  function registerImage(url: string): string {
    const id = randomUUID();
    images.set(id, url);
    trim(images, MAX_IMAGES);
    return id;
  }

  const hostLabel = (url: string) => new URL(url).hostname.replace(/^www\./, '');

  async function youtube(url: string): Promise<LinkPreview | null> {
    const response = await safeGet(`https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(url)}`, {
      allowPrivate,
      accept: 'application/json',
      limit: ({ status }) => (status === 200 ? OEMBED_LIMIT : null),
    });
    if (!response || response.truncated) return null;
    const data = JSON.parse(response.body.toString('utf8')) as { title?: string; author_name?: string; thumbnail_url?: string; thumbnail_width?: number; thumbnail_height?: number };
    if (!data.title) return null;
    return {
      url,
      kind: 'page',
      title: data.title.slice(0, 150),
      description: data.author_name?.slice(0, 100) ?? null,
      siteName: 'YouTube',
      image: data.thumbnail_url ? { id: registerImage(data.thumbnail_url), width: data.thumbnail_width ?? null, height: data.thumbnail_height ?? null } : null,
    };
  }

  async function page(url: string): Promise<LinkPreview | null> {
    const response = await safeGet(url, {
      allowPrivate,
      accept: 'text/html,application/xhtml+xml,image/*;q=0.8',
      limit: ({ status, headers }) => {
        if (status < 200 || status >= 300) return null;
        const type = typeOf(headers);
        return isImageType(type) ? SNIFF_LIMIT : isHtmlType(type) ? HTML_LIMIT : null;
      },
    });
    if (!response) return null;

    const type = typeOf(response.headers);
    if (isImageType(type)) {
      // Uma imagem direta (inclusive GIF): o tipo e o tamanho vêm dos bytes.
      const info = sniffImage(response.body);
      if (!info) return null;
      return { url, kind: 'image', title: null, description: null, siteName: hostLabel(response.url), image: { id: registerImage(response.url), width: info.width, height: info.height } };
    }

    const info = parsePage(decodeHtml(response.body, response.headers['content-type']), response.url);
    if (!info.title && !info.description && !info.image) return null;
    return {
      url,
      kind: 'page',
      title: info.title,
      description: info.description,
      siteName: info.siteName ?? hostLabel(response.url),
      image: info.image ? { id: registerImage(info.image), width: info.imageWidth, height: info.imageHeight } : null,
    };
  }

  async function build(url: string): Promise<LinkPreview | null> {
    try {
      const host = new URL(url).hostname;
      if (YOUTUBE.test(host)) {
        const fromOembed = await youtube(url).catch(() => null);
        if (fromOembed) return fromOembed;
      }
      return await page(url);
    } catch (err) {
      if (!(err instanceof UnsafeUrlError)) console.warn('[embeds]', hostLabel(url), (err as Error).message);
      return null;
    }
  }

  return {
    async preview(url) {
      const cached = previews.get(url);
      if (cached && now() - cached.at < (cached.value ? TTL_MS : MISS_TTL_MS)) return cached.value;
      const inFlight = pending.get(url);
      if (inFlight) return inFlight;
      const job = slot(() => build(url)).then((value) => {
        previews.set(url, { at: now(), value });
        trim(previews, MAX_PREVIEWS);
        return value;
      });
      pending.set(url, job);
      try {
        return await job;
      } finally {
        pending.delete(url);
      }
    },

    async image(id) {
      const cached = bodies.get(id);
      if (cached) return cached;
      const url = images.get(id);
      if (!url) return null;
      try {
        const response = await slot(() =>
          safeGet(url, {
            allowPrivate,
            accept: 'image/png,image/jpeg,image/gif,image/webp,image/*;q=0.5',
            limit: ({ status, headers }) => (status === 200 && isImageType(typeOf(headers)) ? IMAGE_LIMIT : null),
          }),
        );
        if (!response || response.truncated) return null;
        const info = sniffImage(response.body);
        if (!info) return null;
        const entry = { type: info.type, body: response.body };
        bodies.set(id, entry);
        bodyBytes += entry.body.length;
        for (const [oldId, old] of bodies) {
          if (bodyBytes <= IMAGE_CACHE_BYTES || oldId === id) break;
          bodies.delete(oldId);
          bodyBytes -= old.body.length;
        }
        return entry;
      } catch (err) {
        if (!(err instanceof UnsafeUrlError)) console.warn('[embeds] imagem', (err as Error).message);
        return null;
      }
    },
  };
}
