// Que tipo de imagem é e qual o tamanho, lendo só o começo do arquivo. O tipo vem dos bytes, e não do que o site
// diz, porque o que o servidor repassa ao navegador não pode ser outra coisa (um SVG com script, um HTML).

export type RasterType = 'image/png' | 'image/jpeg' | 'image/gif' | 'image/webp';

export interface ImageInfo {
  type: RasterType;
  /** `null` se o começo do arquivo não bastou para ler. */
  width: number | null;
  height: number | null;
}

const be16 = (b: Buffer, at: number) => (at + 2 <= b.length ? b.readUInt16BE(at) : null);
const le16 = (b: Buffer, at: number) => (at + 2 <= b.length ? b.readUInt16LE(at) : null);
const le24 = (b: Buffer, at: number) => (at + 3 <= b.length ? b[at] | (b[at + 1] << 8) | (b[at + 2] << 16) : null);

/** Os markers do JPEG que trazem o tamanho (SOF), sem DHT (C4), JPG (C8) e DAC (CC). */
const isFrameMarker = (marker: number) => marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker);

function jpegSize(b: Buffer): { width: number | null; height: number | null } {
  let at = 2;
  while (at + 4 <= b.length) {
    if (b[at] !== 0xff) {
      at++;
      continue;
    }
    const marker = b[at + 1];
    if (marker === 0xff) {
      at++;
      continue;
    }
    if (isFrameMarker(marker)) return { height: be16(b, at + 5), width: be16(b, at + 7) };
    const length = be16(b, at + 2);
    if (length === null || length < 2) break;
    at += 2 + length;
  }
  return { width: null, height: null };
}

function webpSize(b: Buffer): { width: number | null; height: number | null } {
  const chunk = b.toString('ascii', 12, 16);
  if (chunk === 'VP8 ') {
    const w = le16(b, 26);
    const h = le16(b, 28);
    return { width: w === null ? null : w & 0x3fff, height: h === null ? null : h & 0x3fff };
  }
  if (chunk === 'VP8L' && b.length >= 25 && b[20] === 0x2f) {
    return {
      width: 1 + (((b[22] & 0x3f) << 8) | b[21]),
      height: 1 + (((b[24] & 0x0f) << 10) | (b[23] << 2) | ((b[22] & 0xc0) >> 6)),
    };
  }
  if (chunk === 'VP8X') {
    const w = le24(b, 24);
    const h = le24(b, 27);
    return { width: w === null ? null : w + 1, height: h === null ? null : h + 1 };
  }
  return { width: null, height: null };
}

/** O tipo e o tamanho de uma imagem PNG, JPEG, GIF ou WebP pelos primeiros bytes; `null` se for outra coisa. */
export function sniffImage(b: Buffer): ImageInfo | null {
  if (b.length >= 24 && b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return { type: 'image/png', width: b.readUInt32BE(16), height: b.readUInt32BE(20) };
  }
  if (b.length >= 10 && (b.toString('ascii', 0, 6) === 'GIF87a' || b.toString('ascii', 0, 6) === 'GIF89a')) {
    return { type: 'image/gif', width: b.readUInt16LE(6), height: b.readUInt16LE(8) };
  }
  if (b.length >= 4 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return { type: 'image/jpeg', ...jpegSize(b) };
  if (b.length >= 16 && b.toString('ascii', 0, 4) === 'RIFF' && b.toString('ascii', 8, 12) === 'WEBP') {
    return { type: 'image/webp', ...webpSize(b) };
  }
  return null;
}
