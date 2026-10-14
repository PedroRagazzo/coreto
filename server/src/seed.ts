import { randomUUID } from 'node:crypto';
import { DEFAULT_EVERYONE_PERMISSIONS, Permission } from '../../shared/src/permissions.js';
import type { Db } from './db/client.js';

/**
 * Cria os dados de demonstração (dois espaços públicos mantidos por um
 * usuário-robô) se o banco ainda não tiver nenhum espaço.
 * Devolve `true` quando criou alguma coisa.
 */
export async function seedIfEmpty(db: Db): Promise<boolean> {
  if ((await db.space.count()) > 0) return false;

  const id = () => randomUUID();
  const bot = id();
  const dev = id();
  const moderation = id();
  const devText = id();
  const devVoice = id();
  const geral = id();
  const avisos = id();
  const privateChannel = id();
  const club = id();
  const clubText = id();
  const clubVoice = id();
  const conversa = id();

  const send = BigInt(Permission.SEND_MESSAGES);
  const view = BigInt(Permission.VIEW_CHANNEL);
  const everyone = BigInt(DEFAULT_EVERYONE_PERMISSIONS);
  // Horários crescentes para manter a ordem das mensagens de boas-vindas.
  const at = (offsetMs: number) => new Date(Date.now() + offsetMs);

  await db.$transaction([
    // O robô reserva o próprio nome: sem PIN, ninguém entra como "Coreto".
    db.user.create({ data: { id: bot, displayName: 'Coreto', loginName: 'coreto', avatarColor: '#2bb39a', isBot: true } }),
    db.space.createMany({
      data: [
        { id: dev, name: 'Coreto Dev', ownerId: bot },
        { id: club, name: 'Clube do Livro', ownerId: bot },
      ],
    }),
    // O cargo @everyone usa o mesmo id do espaço.
    db.role.createMany({
      data: [
        { id: dev, spaceId: dev, name: '@everyone', position: 0, permissions: everyone },
        {
          id: moderation,
          spaceId: dev,
          name: 'Moderação',
          color: '#e5a54b',
          position: 1,
          permissions: BigInt(Permission.MANAGE_MESSAGES | Permission.MANAGE_CHANNELS),
          hoist: true,
        },
        { id: club, spaceId: club, name: '@everyone', position: 0, permissions: everyone },
      ],
    }),
    db.member.createMany({
      data: [
        { spaceId: dev, userId: bot },
        { spaceId: club, userId: bot },
      ],
    }),
    db.category.createMany({
      data: [
        { id: devText, spaceId: dev, name: 'Canais de texto', position: 0 },
        { id: devVoice, spaceId: dev, name: 'Canais de voz', position: 1 },
        { id: clubText, spaceId: club, name: 'Conversas', position: 0 },
        { id: clubVoice, spaceId: club, name: 'Encontros', position: 1 },
      ],
    }),
    db.channel.createMany({
      data: [
        { id: geral, spaceId: dev, categoryId: devText, name: 'geral', kind: 'TEXT', position: 0, topic: 'Conversa livre sobre o projeto' },
        { id: avisos, spaceId: dev, categoryId: devText, name: 'avisos', kind: 'TEXT', position: 1, topic: 'Somente leitura: apenas a moderação publica aqui' },
        { spaceId: dev, categoryId: devText, name: 'ajuda', kind: 'TEXT', position: 2, topic: 'Dúvidas e suporte' },
        { id: privateChannel, spaceId: dev, categoryId: devText, name: 'moderação', kind: 'TEXT', position: 3, topic: 'Canal privado da equipe' },
        { spaceId: dev, categoryId: devVoice, name: 'Sala de estar', kind: 'VOICE', position: 0 },
        { spaceId: dev, categoryId: devVoice, name: 'Pareamento', kind: 'VOICE', position: 1 },
        { id: conversa, spaceId: club, categoryId: clubText, name: 'conversa', kind: 'TEXT', position: 0, topic: 'O que você está lendo?' },
        { spaceId: club, categoryId: clubText, name: 'recomendações', kind: 'TEXT', position: 1 },
        { spaceId: club, categoryId: clubVoice, name: 'Leitura em voz alta', kind: 'VOICE', position: 0 },
      ],
    }),
    db.permissionOverwrite.createMany({
      data: [
        // #avisos: todos leem, só a Moderação escreve.
        { channelId: avisos, targetType: 'ROLE', targetId: dev, deny: send },
        { channelId: avisos, targetType: 'ROLE', targetId: moderation, allow: send },
        // #moderação: invisível para quem não é da Moderação.
        { channelId: privateChannel, targetType: 'ROLE', targetId: dev, deny: view },
        { channelId: privateChannel, targetType: 'ROLE', targetId: moderation, allow: view },
      ],
    }),
    db.message.createMany({
      data: [
        { channelId: geral, authorId: bot, createdAt: at(0), content: 'Bem-vindo ao Coreto! Este espaço é público: todo mundo que entra vira membro.' },
        { channelId: geral, authorId: bot, createdAt: at(1), content: 'Clique em um canal de voz para entrar e clique em "Sair da chamada" para sair.' },
        { channelId: avisos, authorId: bot, createdAt: at(2), content: 'Neste canal, só a moderação pode escrever. É um exemplo de sobrescrita de permissão.' },
        { channelId: conversa, authorId: bot, createdAt: at(3), content: 'Leitura do mês: escolham nos comentários!' },
      ],
    }),
  ]);
  return true;
}
