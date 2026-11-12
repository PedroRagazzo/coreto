import { describe, expect, it } from 'vitest';
import { preferHardwareH264 } from '../../../shared/src/h264.js';

const h264 = (profile: string, mode = 1) => ({
  mimeType: 'video/H264',
  sdpFmtpLine: `level-asymmetry-allowed=1;packetization-mode=${mode};profile-level-id=${profile}`,
});
const vp8 = { mimeType: 'video/VP8' };
const rtx = { mimeType: 'video/rtx', sdpFmtpLine: 'apt=96' };

// A lista que o Chrome 14x no Windows informa, na ordem dele.
const chrome = [vp8, rtx, h264('42001f'), h264('42001f', 0), h264('42e01f'), h264('42e01f', 0), h264('4d001f'), h264('4d001f', 0), h264('640032')];

const profiles = (list: { mimeType: string; sdpFmtpLine?: string }[] | null) =>
  (list ?? []).filter((c) => c.sdpFmtpLine?.includes('profile-level-id')).map((c) => /profile-level-id=(\w+)/.exec(c.sdpFmtpLine!)![1] + '/' + /packetization-mode=(\d)/.exec(c.sdpFmtpLine!)![1]);

describe('preferHardwareH264', () => {
  it('põe High, Main e Baseline na frente e deixa o Constrained Baseline (processador) por último', () => {
    expect(profiles(preferHardwareH264(chrome))).toEqual(['640032/1', '4d001f/1', '4d001f/0', '42001f/1', '42001f/0', '42e01f/1', '42e01f/0']);
  });

  it('põe os H.264 antes dos outros codecs e mantém o resto na ordem', () => {
    const ordered = preferHardwareH264(chrome)!;
    expect(ordered.slice(0, 7).every((c) => c.mimeType === 'video/H264')).toBe(true);
    expect(ordered.slice(7)).toEqual([vp8, rtx]);
    expect(ordered).toHaveLength(chrome.length);
  });

  it('não repete nem perde codec', () => {
    const ordered = preferHardwareH264(chrome)!;
    expect(new Set(ordered).size).toBe(chrome.length);
    for (const codec of chrome) expect(ordered).toContain(codec);
  });

  it('mantém a ordem do navegador entre perfis iguais (packetization-mode=1 antes do 0)', () => {
    const ordered = preferHardwareH264([h264('42e01f', 1), h264('42e01f', 0), h264('4d001f', 1), h264('4d001f', 0)])!;
    expect(profiles(ordered)).toEqual(['4d001f/1', '4d001f/0', '42e01f/1', '42e01f/0']);
  });

  it('entende o perfil High em qualquer nível (640c1f, 64001f)', () => {
    expect(profiles(preferHardwareH264([h264('42e01f'), h264('640c1f'), h264('64001f')]))).toEqual(['640c1f/1', '64001f/1', '42e01f/1']);
  });

  it('sem H.264 ou com a ordem já certa, não há o que mudar', () => {
    expect(preferHardwareH264([vp8, rtx])).toBeNull();
    expect(preferHardwareH264([])).toBeNull();
    expect(preferHardwareH264([h264('640032'), h264('42e01f'), vp8])).toBeNull();
  });

  it('só o Constrained Baseline (navegador sem placa) também não muda nada', () => {
    expect(preferHardwareH264([vp8, h264('42e01f'), h264('42e01f', 0)])).toBeNull();
  });

  it('perfis desconhecidos ou sem profile-level-id ficam depois dos conhecidos, sem quebrar', () => {
    const odd = { mimeType: 'video/H264', sdpFmtpLine: 'packetization-mode=1' };
    expect(preferHardwareH264([odd, h264('4d001f')])).toEqual([h264('4d001f'), odd]);
  });

  it('não altera a lista que recebeu', () => {
    const copy = [...chrome];
    preferHardwareH264(chrome);
    expect(chrome).toEqual(copy);
  });
});
