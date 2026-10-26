import { describe, expect, it } from 'vitest';
import { cleanSoundEmoji, cleanSoundName, MAX_SOUND_NAME, sniffAudio } from '../../../shared/src/sounds.js';

const bytes = (...parts: (string | number[])[]): Uint8Array =>
  Uint8Array.from(parts.flatMap((p) => (typeof p === 'string' ? [...p].map((c) => c.charCodeAt(0)) : p)));
const pad = (data: Uint8Array, to = 32): Uint8Array => {
  const out = new Uint8Array(Math.max(to, data.length));
  out.set(data);
  return out;
};

describe('sniffAudio', () => {
  it('reconhece MP3 (com etiqueta ID3 e sem), OGG, WAV, WebM e M4A pelo conteúdo', () => {
    expect(sniffAudio(pad(bytes('ID3', [3, 0, 0])))).toBe('audio/mpeg');
    expect(sniffAudio(pad(Uint8Array.from([0xff, 0xfb, 0x90, 0x00])))).toBe('audio/mpeg');
    expect(sniffAudio(pad(bytes('OggS')))).toBe('audio/ogg');
    expect(sniffAudio(pad(bytes('RIFF', [0, 0, 0, 0], 'WAVE', 'fmt ')))).toBe('audio/wav');
    expect(sniffAudio(pad(Uint8Array.from([0x1a, 0x45, 0xdf, 0xa3])))).toBe('audio/webm');
    expect(sniffAudio(pad(bytes([0, 0, 0, 0x20], 'ftypM4A ')))).toBe('audio/mp4');
  });

  it('recusa o que não é áudio, venha com a extensão ou o tipo que vier', () => {
    expect(sniffAudio(pad(bytes('<html><script>alert(1)</script></html>')))).toBeNull();
    expect(sniffAudio(pad(bytes('<svg xmlns="http://www.w3.org/2000/svg"/>')))).toBeNull();
    expect(sniffAudio(pad(bytes('MZ', [0x90, 0, 3, 0])))).toBeNull(); // um .exe
    expect(sniffAudio(pad(bytes('RIFF', [0, 0, 0, 0], 'AVI ', 'LIST')))).toBeNull(); // RIFF que não é WAVE
    expect(sniffAudio(Uint8Array.from([0xff, 0xff, 0xff, 0xff]))).toBeNull(); // curto demais
    expect(sniffAudio(new Uint8Array(0))).toBeNull();
  });
});

describe('cleanSoundName', () => {
  it('deixa uma linha só, sem espaços sobrando nem caracteres de controle', () => {
    expect(cleanSoundName('  Palmas   da\ttorcida \u0000 ')).toBe('Palmas da torcida');
    expect(cleanSoundName('fim‮gpj')).toBe('fim gpj');
  });

  it('corta no limite e recusa o vazio', () => {
    expect(cleanSoundName('x'.repeat(100))).toHaveLength(MAX_SOUND_NAME);
    expect(cleanSoundName('   ')).toBeNull();
    expect(cleanSoundName(42)).toBeNull();
    expect(cleanSoundName(undefined)).toBeNull();
  });
});

describe('cleanSoundEmoji', () => {
  it('aceita um emoji só, inclusive com tom de pele, bandeira e junção', () => {
    for (const emoji of ['😂', '👍🏽', '🇧🇷', '👨‍👩‍👧', '🔥']) expect(cleanSoundEmoji(emoji)).toBe(emoji);
  });

  it('recusa texto, vários emojis e o que não é emoji', () => {
    for (const bad of ['a', 'oi', '😂😂', '', '   ', '<b>', 5, null, undefined, '1']) expect(cleanSoundEmoji(bad)).toBeNull();
  });
});
