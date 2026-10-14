import { describe, expect, it } from 'vitest';
import { imageInfo } from '../../src/images.js';

// Só os cabeçalhos importam para imageInfo; o resto do arquivo é enchimento.
const pad = (head: number[] | Buffer, total = 64) => Buffer.concat([Buffer.from(head), Buffer.alloc(total)]);
const u32be = (n: number) => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
const u16le = (n: number) => [n & 255, (n >>> 8) & 255];
const u24le = (n: number) => [n & 255, (n >>> 8) & 255, (n >>> 16) & 255];
const ascii = (s: string) => [...Buffer.from(s, 'latin1')];

const png = (w: number, h: number) =>
  pad([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, ...u32be(13), ...ascii('IHDR'), ...u32be(w), ...u32be(h)]);

describe('imageInfo', () => {
  it('lê PNG', () => {
    expect(imageInfo(png(640, 480))).toEqual({ contentType: 'image/png', width: 640, height: 480 });
  });

  it('lê GIF', () => {
    expect(imageInfo(pad([...ascii('GIF89a'), ...u16le(32), ...u16le(16)]))).toEqual({
      contentType: 'image/gif',
      width: 32,
      height: 16,
    });
  });

  it('lê JPEG pulando os segmentos antes do quadro', () => {
    const app0 = [0xff, 0xe0, 0x00, 0x10, ...ascii('JFIF'), 0, 1, 1, 0, 0, 1, 0, 1, 0, 0];
    const sof2 = [0xff, 0xc2, 0x00, 0x11, 8, 0x01, 0xe0, 0x02, 0x80, 3];
    expect(imageInfo(pad([0xff, 0xd8, ...app0, ...sof2]))).toEqual({ contentType: 'image/jpeg', width: 640, height: 480 });
  });

  it('lê os três formatos de WebP', () => {
    const riff = (chunk: string, body: number[]) => pad([...ascii('RIFF'), 0, 0, 0, 0, ...ascii('WEBP'), ...ascii(chunk), 0, 0, 0, 0, ...body]);
    expect(imageInfo(riff('VP8X', [0, 0, 0, 0, ...u24le(1919), ...u24le(1079)]))).toEqual({
      contentType: 'image/webp',
      width: 1920,
      height: 1080,
    });
    expect(imageInfo(riff('VP8 ', [0, 0, 0, 0x9d, 0x01, 0x2a, ...u16le(300), ...u16le(200)]))?.width).toBe(300);
    const bits = (100 - 1) | ((50 - 1) << 14);
    expect(imageInfo(riff('VP8L', [0x2f, bits & 255, (bits >> 8) & 255, (bits >> 16) & 255, (bits >> 24) & 255]))).toEqual({
      contentType: 'image/webp',
      width: 100,
      height: 50,
    });
  });

  it('recusa o que não é imagem conhecida ou tem dimensões absurdas', () => {
    expect(imageInfo(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>'))).toBeNull();
    expect(imageInfo(Buffer.from('GIF8'))).toBeNull();
    expect(imageInfo(Buffer.alloc(0))).toBeNull();
    expect(imageInfo(png(0, 10))).toBeNull();
    expect(imageInfo(png(100_000, 10))).toBeNull();
  });
});
