// Reconhece imagens pelo conteúdo (não pela extensão nem pelo tipo que o
// navegador declarou) e lê as dimensões do cabeçalho. As dimensões vão para o
// cliente reservar o espaço da imagem antes de ela carregar.

import type { ATTACHMENT_TYPES } from '../../shared/src/protocol.js';

export interface ImageInfo {
  contentType: (typeof ATTACHMENT_TYPES)[number];
  width: number;
  height: number;
}

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
/** Marcadores JPEG "start of frame", que trazem as dimensões (C4, C8 e CC são outra coisa). */
const JPEG_SOF = new Set([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf]);
const MAX_SIDE = 30_000;

/** Tipo e dimensões da imagem, ou `null` se não for PNG, JPEG, GIF ou WebP reconhecível. */
export function imageInfo(data: Buffer): ImageInfo | null {
  const info = png(data) ?? gif(data) ?? webp(data) ?? jpeg(data);
  if (!info || info.width < 1 || info.height < 1 || info.width > MAX_SIDE || info.height > MAX_SIDE) return null;
  return info;
}

function png(data: Buffer): ImageInfo | null {
  if (data.length < 24 || !data.subarray(0, 8).equals(PNG_SIGNATURE)) return null;
  if (data.toString('latin1', 12, 16) !== 'IHDR') return null;
  return { contentType: 'image/png', width: data.readUInt32BE(16), height: data.readUInt32BE(20) };
}

function gif(data: Buffer): ImageInfo | null {
  const signature = data.toString('latin1', 0, 6);
  if (data.length < 10 || (signature !== 'GIF87a' && signature !== 'GIF89a')) return null;
  return { contentType: 'image/gif', width: data.readUInt16LE(6), height: data.readUInt16LE(8) };
}

function webp(data: Buffer): ImageInfo | null {
  if (data.length < 30 || data.toString('latin1', 0, 4) !== 'RIFF' || data.toString('latin1', 8, 12) !== 'WEBP') {
    return null;
  }
  const result = (width: number, height: number): ImageInfo => ({ contentType: 'image/webp', width, height });
  switch (data.toString('latin1', 12, 16)) {
    case 'VP8X': // estendido: largura e altura menos 1, 24 bits cada
      return result(data.readUIntLE(24, 3) + 1, data.readUIntLE(27, 3) + 1);
    case 'VP8 ': // com perdas: código de início 9d 01 2a, depois 14 bits de cada lado
      if (data[23] !== 0x9d || data[24] !== 0x01 || data[25] !== 0x2a) return null;
      return result(data.readUInt16LE(26) & 0x3fff, data.readUInt16LE(28) & 0x3fff);
    case 'VP8L': {
      // sem perdas: assinatura 0x2f, depois 14 + 14 bits (menos 1)
      if (data[20] !== 0x2f) return null;
      const bits = data.readUInt32LE(21);
      return result((bits & 0x3fff) + 1, ((bits >> 14) & 0x3fff) + 1);
    }
    default:
      return null;
  }
}

function jpeg(data: Buffer): ImageInfo | null {
  if (data.length < 4 || data[0] !== 0xff || data[1] !== 0xd8) return null;
  let i = 2;
  while (i + 9 < data.length) {
    if (data[i] !== 0xff) return null;
    const marker = data[i + 1];
    if (marker === 0xff) {
      i += 1; // preenchimento
      continue;
    }
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      i += 2; // marcadores sem tamanho
      continue;
    }
    if (JPEG_SOF.has(marker)) {
      return { contentType: 'image/jpeg', height: data.readUInt16BE(i + 5), width: data.readUInt16BE(i + 7) };
    }
    i += 2 + data.readUInt16BE(i + 2);
  }
  return null;
}
