// Que som tocar quando a chamada muda: decidido aqui, sem tocar nada, para dar para testar.

import type { Id, VoiceParticipant } from './models.js';

export type SoundKind = 'join' | 'leave' | 'streamJoin' | 'streamLeave' | 'mute' | 'unmute' | 'deafen' | 'undeafen';

/** A chamada em que você está, num instante. */
export interface CallSnapshot {
  /** `null` = fora de qualquer chamada. */
  channelId: Id | null;
  room: ReadonlyMap<Id, VoiceParticipant>;
  muted: boolean;
  deafened: boolean;
}

/**
 * Sons para a mudança entre dois instantes da sua chamada:
 * - você entra ou sai da chamada;
 * - você muta ou ensurdece (ensurdecer também muta, então o som do "som" tem prioridade);
 * - alguém entra ou sai da chamada;
 * - alguém começa ou para de assistir à transmissão que você faz ou assiste.
 *
 * `settled` é falso logo depois de você entrar: a lista da sala ainda está chegando, e quem já
 * estava lá não conta como "entrou". Ensurdecido, você não ouve ninguém entrar ou sair.
 * Cada tipo de som aparece uma vez só, mesmo que vários eventos aconteçam juntos.
 */
export function soundsForChange(before: CallSnapshot, now: CallSnapshot, me: Id | null, settled: boolean): SoundKind[] {
  if (now.channelId !== before.channelId) return [now.channelId ? 'join' : 'leave'];
  if (!now.channelId) return [];

  const sounds = new Set<SoundKind>();
  if (now.deafened !== before.deafened) sounds.add(now.deafened ? 'deafen' : 'undeafen');
  else if (now.muted !== before.muted) sounds.add(now.muted ? 'mute' : 'unmute');

  if (now.deafened || !settled) return [...sounds];

  // As transmissões em que você está: a sua e a que você assiste.
  const watching = me ? now.room.get(me)?.watching : null;
  const streams = new Set<Id>([...(me ? [me] : []), ...(watching ? [watching] : [])]);

  for (const [id, person] of now.room) {
    if (id === me) continue;
    const was = before.room.get(id);
    if (!was) {
      sounds.add('join');
      continue;
    }
    for (const stream of streams) {
      if (person.watching === stream && was.watching !== stream) sounds.add('streamJoin');
      else if (was.watching === stream && person.watching !== stream) sounds.add('streamLeave');
    }
  }
  for (const id of before.room.keys()) if (id !== me && !now.room.has(id)) sounds.add('leave');
  return [...sounds];
}
