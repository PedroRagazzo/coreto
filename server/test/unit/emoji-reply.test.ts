import { describe, expect, it } from 'vitest';
import { isReactionEmoji, REACTION_EMOJIS } from '../../../shared/src/emoji.js';
import { deletedReply, replyExcerpt, replyPreviewOf } from '../../../shared/src/reply.js';

describe('isReactionEmoji', () => {
  it.each(['👍', '❤️', '🎉', '🇧🇷', '👍🏽', '👨‍👩‍👧', '🏳️‍🌈', '1️⃣', '#️⃣', '✅'])('aceita %s', (emoji) => {
    expect(isReactionEmoji(emoji)).toBe(true);
  });

  it.each(['', 'a', 'A1', 'oi', '👍👍', '👍 ', ' 👍', '<b>', 'x👍', '👍x', '123', '\n'])('recusa %j', (text) => {
    expect(isReactionEmoji(text)).toBe(false);
  });

  it('recusa o que não é texto e o que é longo demais', () => {
    for (const value of [undefined, null, 5, {}, ['👍']]) expect(isReactionEmoji(value)).toBe(false);
    expect(isReactionEmoji('👨‍👩‍👧‍👦'.repeat(8))).toBe(false);
  });

  it('todos os emojis do seletor são válidos e sem repetição', () => {
    expect(REACTION_EMOJIS.every(isReactionEmoji)).toBe(true);
    expect(new Set(REACTION_EMOJIS).size).toBe(REACTION_EMOJIS.length);
  });
});

describe('resumo da mensagem respondida', () => {
  it('põe numa linha só e corta o que passa de 100 caracteres', () => {
    expect(replyExcerpt('  uma\n\nlinha   só \t ok ')).toBe('uma linha só ok');
    const cut = replyExcerpt('b'.repeat(300));
    expect(cut).toHaveLength(100);
    expect(cut.endsWith('…')).toBe(true);
    expect(replyExcerpt('c'.repeat(100))).toBe('c'.repeat(100));
  });

  it('marca se a original tinha imagens e como fica quando ela some', () => {
    expect(replyPreviewOf({ id: 'm', authorId: 'ana', content: '', attachments: [{}] })).toEqual({
      id: 'm',
      deleted: false,
      authorId: 'ana',
      excerpt: '',
      hasAttachments: true,
    });
    expect(deletedReply('m')).toEqual({ id: 'm', deleted: true, authorId: null, excerpt: '', hasAttachments: false });
  });
});
