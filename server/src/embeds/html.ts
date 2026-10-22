// O que uma página diz sobre si mesma para a pré-visualização: as tags Open Graph (og:title...), as do Twitter
// (twitter:title...) e, na falta delas, o <title> e a descrição comum. Sem biblioteca de HTML: só se leem as tags
// <meta> e <title> do começo da página, e o resultado vai ao site como texto puro (nunca como HTML).

export interface PageInfo {
  title: string | null;
  description: string | null;
  siteName: string | null;
  /** Endereço absoluto da imagem de destaque. */
  image: string | null;
  imageWidth: number | null;
  imageHeight: number | null;
}

const NAMED: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

export function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, entity: string) => {
    if (entity[0] === '#') {
      const code = entity[1].toLowerCase() === 'x' ? parseInt(entity.slice(2), 16) : parseInt(entity.slice(1), 10);
      return Number.isInteger(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : whole;
    }
    return NAMED[entity.toLowerCase()] ?? whole;
  });
}

/** Texto de uma tag, numa linha só, sem espaços sobrando. */
const clean = (value: string | undefined, max: number): string | null => {
  const text = decodeEntities(value ?? '').replace(/\s+/g, ' ').trim();
  if (!text) return null;
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
};

function attributes(tag: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const m of tag.matchAll(/([a-zA-Z_:][-a-zA-Z0-9_:.]*)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/g)) {
    result[m[1].toLowerCase()] ??= m[2] ?? m[3] ?? m[4] ?? '';
  }
  return result;
}

const positiveInt = (value: string | undefined): number | null => {
  const n = Number.parseInt(value ?? '', 10);
  return Number.isInteger(n) && n > 0 && n < 20_000 ? n : null;
};

/** Lê a página; `baseUrl` serve para tornar absoluto o endereço da imagem. */
export function parsePage(html: string, baseUrl: string): PageInfo {
  const head = html.split(/<\/head\s*>/i)[0] ?? html;
  const meta = new Map<string, string>();
  for (const m of head.matchAll(/<meta\b([^>]*)>/gi)) {
    const attrs = attributes(m[1]);
    const key = (attrs.property ?? attrs.name)?.toLowerCase();
    if (key && attrs.content !== undefined && !meta.has(key)) meta.set(key, attrs.content);
  }
  const pageTitle = /<title\b[^>]*>([\s\S]*?)<\/title\s*>/i.exec(head)?.[1];

  let image: string | null = null;
  const rawImage = (meta.get('og:image') ?? meta.get('og:image:url') ?? meta.get('twitter:image') ?? meta.get('twitter:image:src') ?? '').trim();
  if (rawImage) {
    try {
      const url = new URL(decodeEntities(rawImage), baseUrl);
      if (url.protocol === 'http:' || url.protocol === 'https:') image = url.toString();
    } catch {
      // endereço de imagem inválido: segue sem imagem
    }
  }
  return {
    title: clean(meta.get('og:title') ?? meta.get('twitter:title') ?? pageTitle, 150),
    description: clean(meta.get('og:description') ?? meta.get('twitter:description') ?? meta.get('description'), 300),
    siteName: clean(meta.get('og:site_name'), 60),
    image,
    imageWidth: image ? positiveInt(meta.get('og:image:width')) : null,
    imageHeight: image ? positiveInt(meta.get('og:image:height')) : null,
  };
}

/** Decodifica o corpo da página pela codificação que o site declarou (UTF-8 se não declarou ou se for desconhecida). */
export function decodeHtml(body: Buffer, contentType: string | undefined): string {
  const declared = /charset\s*=\s*["']?([\w-]+)/i.exec(contentType ?? '')?.[1] ?? /<meta[^>]+charset\s*=\s*["']?([\w-]+)/i.exec(body.toString('latin1', 0, 2048))?.[1];
  try {
    return new TextDecoder(declared ?? 'utf-8').decode(body);
  } catch {
    return new TextDecoder('utf-8').decode(body);
  }
}
