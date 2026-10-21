import { describe, expect, it } from 'vitest';
import { soundsForChange, type CallSnapshot } from '../../../shared/src/call-sounds.js';
import type { VoiceParticipant } from '../../../shared/src/models.js';

const person = (userId: string, patch: Partial<VoiceParticipant> = {}): VoiceParticipant => ({
  userId,
  channelId: 'sala',
  muted: false,
  deafened: false,
  video: false,
  streaming: false,
  streamTitle: null,
  activity: null,
  watching: null,
  ...patch,
});

const call = (people: VoiceParticipant[], patch: Partial<CallSnapshot> = {}): CallSnapshot => ({
  channelId: 'sala',
  room: new Map(people.map((p) => [p.userId, p])),
  muted: false,
  deafened: false,
  ...patch,
});

const idle = call([], { channelId: null });
const ME = 'eu';

describe('soundsForChange', () => {
  it('toca "entrar" ao entrar numa chamada e "sair" ao sair, sem avisar de quem já estava lá', () => {
    const inCall = call([person(ME), person('ana')]);
    expect(soundsForChange(idle, inCall, ME, false)).toEqual(['join']);
    expect(soundsForChange(inCall, idle, ME, true)).toEqual(['leave']);
  });

  it('avisa quando alguém entra ou sai da chamada', () => {
    const before = call([person(ME), person('ana')]);
    const after = call([person(ME), person('ana'), person('bia')]);
    expect(soundsForChange(before, after, ME, true)).toEqual(['join']);
    expect(soundsForChange(after, before, ME, true)).toEqual(['leave']);
  });

  it('não avisa de quem já estava na sala logo depois de você entrar', () => {
    const before = call([person(ME)]);
    const after = call([person(ME), person('ana'), person('bia')]);
    expect(soundsForChange(before, after, ME, false)).toEqual([]);
  });

  it('junta vários que entram de uma vez num som só', () => {
    const before = call([person(ME)]);
    const after = call([person(ME), person('ana'), person('bia'), person('caio')]);
    expect(soundsForChange(before, after, ME, true)).toEqual(['join']);
  });

  it('avisa quando alguém começa ou para de assistir à sua transmissão', () => {
    const before = call([person(ME, { streaming: true }), person('ana')]);
    const after = call([person(ME, { streaming: true }), person('ana', { watching: ME })]);
    expect(soundsForChange(before, after, ME, true)).toEqual(['streamJoin']);
    expect(soundsForChange(after, before, ME, true)).toEqual(['streamLeave']);
  });

  it('avisa quando alguém entra na transmissão que você está assistindo', () => {
    const before = call([person(ME, { watching: 'ana' }), person('ana', { streaming: true }), person('bia')]);
    const after = call([person(ME, { watching: 'ana' }), person('ana', { streaming: true }), person('bia', { watching: 'ana' })]);
    expect(soundsForChange(before, after, ME, true)).toEqual(['streamJoin']);
  });

  it('ignora quem assiste a uma transmissão em que você não está', () => {
    const before = call([person(ME), person('ana', { streaming: true }), person('bia')]);
    const after = call([person(ME), person('ana', { streaming: true }), person('bia', { watching: 'ana' })]);
    expect(soundsForChange(before, after, ME, true)).toEqual([]);
  });

  it('toca o som de mutar e de reativar o microfone', () => {
    const open = call([person(ME)]);
    const muted = call([person(ME)], { muted: true });
    expect(soundsForChange(open, muted, ME, true)).toEqual(['mute']);
    expect(soundsForChange(muted, open, ME, true)).toEqual(['unmute']);
  });

  it('ensurdecer toca só o som de ensurdecer, mesmo mutando o microfone junto', () => {
    const open = call([person(ME)]);
    const deaf = call([person(ME)], { muted: true, deafened: true });
    expect(soundsForChange(open, deaf, ME, true)).toEqual(['deafen']);
    expect(soundsForChange(deaf, open, ME, true)).toEqual(['undeafen']);
  });

  it('ensurdecido, não ouve ninguém entrar ou sair', () => {
    const before = call([person(ME)], { muted: true, deafened: true });
    const after = call([person(ME), person('ana')], { muted: true, deafened: true });
    expect(soundsForChange(before, after, ME, true)).toEqual([]);
  });

  it('não toca nada quando nada muda para você', () => {
    const state = call([person(ME), person('ana')]);
    expect(soundsForChange(state, call([person(ME), person('ana', { muted: true })]), ME, true)).toEqual([]);
    expect(soundsForChange(idle, idle, ME, true)).toEqual([]);
  });
});
