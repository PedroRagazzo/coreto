import { describe, expect, it } from 'vitest';
import type { Message } from '../../../shared/src/models.js';
import { NOTIFICATION_BODY_LENGTH, toastFor, type ToastInput } from '../../../shared/src/notify.js';

const ME = 'eu';
const NAMES: Record<string, string> = { eu: 'Eu', ana: 'Ana', bia: 'Bia' };

const message = (patch: Partial<Message> = {}): Message => ({
  id: 'm1',
  channelId: 'canal-1',
  authorId: 'ana',
  content: 'oi',
  attachments: [],
  createdAt: '2026-10-22T12:00:00.000Z',
  editedAt: null,
  replyTo: null,
  reactions: [],
  poll: null,
  roulette: null,
  ...patch,
});

const input = (patch: Partial<ToastInput> = {}): ToastInput => ({
  me: ME,
  message: message(),
  nameOf: (id) => NAMES[id] ?? null,
  channelName: null,
  authorIsBot: false,
  preview: true,
  ...patch,
});

describe('toastFor', () => {
  it('avisa de toda mensagem direta de outra pessoa, com o nome dela e o texto', () => {
    expect(toastFor(input({ message: message({ content: 'bora jogar?' }) }))).toEqual({
      title: 'Ana',
      body: 'bora jogar?',
      tag: 'canal-1',
    });
  });

  it('em canais, só avisa se menciona você ou responde a você', () => {
    const channel = { channelName: 'geral' };
    expect(toastFor(input({ ...channel, message: message({ content: 'bom dia, pessoal' }) }))).toBeNull();
    expect(toastFor(input({ ...channel, message: message({ content: `oi <@${ME}>, tudo bem?` }) }))).toEqual({
      title: 'Ana em #geral',
      body: 'oi @Eu, tudo bem?',
      tag: 'canal-1',
    });
    const reply = message({ replyTo: { id: 'm0', deleted: false, authorId: ME, excerpt: 'x', hasAttachments: false } });
    expect(toastFor(input({ ...channel, message: reply }))?.title).toBe('Ana em #geral');
    // Responder a outra pessoa, ou mencionar outra, não é com você.
    const other = message({ content: '<@bia> vem', replyTo: { id: 'm0', deleted: false, authorId: 'bia', excerpt: 'x', hasAttachments: false } });
    expect(toastFor(input({ ...channel, message: other }))).toBeNull();
  });

  it('nunca avisa das próprias mensagens nem das de robôs', () => {
    expect(toastFor(input({ message: message({ authorId: ME }) }))).toBeNull();
    expect(toastFor(input({ authorIsBot: true }))).toBeNull();
  });

  it('sem a prévia, não mostra o texto, só o que aconteceu', () => {
    const channel = { channelName: 'geral', preview: false };
    expect(toastFor(input({ preview: false }))?.body).toBe('Enviou uma mensagem');
    expect(toastFor(input({ ...channel, message: message({ content: `<@${ME}> segredo` }) }))?.body).toBe('Mencionou você');
    const reply = message({ content: 'segredo', replyTo: { id: 'm0', deleted: false, authorId: ME, excerpt: '', hasAttachments: false } });
    expect(toastFor(input({ ...channel, message: reply }))?.body).toBe('Respondeu a você');
  });

  it('põe o texto numa linha só e corta o que passa do limite', () => {
    expect(toastFor(input({ message: message({ content: 'uma\n\nlinha   só' }) }))?.body).toBe('uma linha só');
    const long = toastFor(input({ message: message({ content: 'z'.repeat(500) }) }))!.body;
    expect(long).toHaveLength(NOTIFICATION_BODY_LENGTH);
    expect(long.endsWith('…')).toBe(true);
  });

  it('diz que veio uma imagem quando a mensagem não tem texto', () => {
    const image = { id: 'a', fileName: 'f.png', contentType: 'image/png', size: 1, width: 1, height: 1 };
    expect(toastFor(input({ message: message({ content: '', attachments: [image] }) }))?.body).toBe('Enviou uma imagem');
    expect(toastFor(input({ message: message({ content: '', attachments: [image, image] }) }))?.body).toBe('Enviou 2 imagens');
  });

  it('usa "Alguém" quando não sabe o nome de quem escreveu', () => {
    expect(toastFor(input({ message: message({ authorId: 'fantasma' }) }))?.title).toBe('Alguém');
  });
});
