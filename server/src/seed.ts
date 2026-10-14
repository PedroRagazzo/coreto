import { Permission } from '../../shared/src/permissions.js';
import type { Store } from './store.js';

/** Dados de demonstração: dois espaços públicos mantidos por um usuário-robô. */
export function seed(store: Store): void {
  const bot = store.createUser('Coreto', { isBot: true });

  // ── Espaço 1 ───────────────────────────────────────────────────────────────
  const dev = store.createSpace('Coreto Dev', bot.id);
  const moderation = store.createRole({
    spaceId: dev.id,
    name: 'Moderação',
    color: '#e5a54b',
    position: 1,
    permissions: Permission.MANAGE_MESSAGES | Permission.MANAGE_CHANNELS,
    hoist: true,
  });

  const devText = store.createCategory(dev.id, 'Canais de texto');
  const devVoice = store.createCategory(dev.id, 'Canais de voz');

  const geral = store.createChannel({
    spaceId: dev.id,
    categoryId: devText.id,
    name: 'geral',
    kind: 'text',
    topic: 'Conversa livre sobre o projeto',
  });
  const avisos = store.createChannel({
    spaceId: dev.id,
    categoryId: devText.id,
    name: 'avisos',
    kind: 'text',
    topic: 'Somente leitura: apenas a moderação publica aqui',
    overwrites: [
      { targetType: 'role', targetId: dev.id, allow: 0, deny: Permission.SEND_MESSAGES },
      { targetType: 'role', targetId: moderation.id, allow: Permission.SEND_MESSAGES, deny: 0 },
    ],
  });
  store.createChannel({ spaceId: dev.id, categoryId: devText.id, name: 'ajuda', kind: 'text', topic: 'Dúvidas e suporte' });
  store.createChannel({
    spaceId: dev.id,
    categoryId: devText.id,
    name: 'moderação',
    kind: 'text',
    topic: 'Canal privado da equipe',
    overwrites: [
      { targetType: 'role', targetId: dev.id, allow: 0, deny: Permission.VIEW_CHANNEL },
      { targetType: 'role', targetId: moderation.id, allow: Permission.VIEW_CHANNEL, deny: 0 },
    ],
  });
  store.createChannel({ spaceId: dev.id, categoryId: devVoice.id, name: 'Sala de estar', kind: 'voice' });
  store.createChannel({ spaceId: dev.id, categoryId: devVoice.id, name: 'Pareamento', kind: 'voice' });

  store.addMessage(geral.id, bot.id, 'Bem-vindo ao Coreto! Este espaço é público: todo mundo que entra vira membro.');
  store.addMessage(geral.id, bot.id, 'Clique em um canal de voz para entrar e clique em "Sair da chamada" para sair.');
  store.addMessage(avisos.id, bot.id, 'Neste canal, só a moderação pode escrever. É um exemplo de sobrescrita de permissão.');

  // ── Espaço 2 ───────────────────────────────────────────────────────────────
  const club = store.createSpace('Clube do Livro', bot.id);
  const clubText = store.createCategory(club.id, 'Conversas');
  const clubVoice = store.createCategory(club.id, 'Encontros');

  const conversa = store.createChannel({
    spaceId: club.id,
    categoryId: clubText.id,
    name: 'conversa',
    kind: 'text',
    topic: 'O que você está lendo?',
  });
  store.createChannel({ spaceId: club.id, categoryId: clubText.id, name: 'recomendações', kind: 'text' });
  store.createChannel({ spaceId: club.id, categoryId: clubVoice.id, name: 'Leitura em voz alta', kind: 'voice' });

  store.addMessage(conversa.id, bot.id, 'Leitura do mês: escolham nos comentários!');
}
