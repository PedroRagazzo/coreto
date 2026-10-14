import { describe, expect, it } from 'vitest';
import type { Channel, Member, PermissionOverwrite, Role, Space } from '../../../shared/src/models.js';
import { ALL_PERMISSIONS, DEFAULT_EVERYONE_PERMISSIONS, hasPermission, Permission } from '../../../shared/src/permissions.js';
import { computeChannelPermissions, computeSpacePermissions } from '../../src/permissions.js';

const { VIEW_CHANNEL, SEND_MESSAGES, MANAGE_CHANNELS, ADMINISTRATOR } = Permission;

const space: Space = { id: 'space', name: 'Espaço', ownerId: 'dono', iconUrl: null };

const role = (id: string, permissions: number): Role => ({
  id,
  spaceId: space.id,
  name: id,
  color: null,
  position: 1,
  permissions,
  hoist: false,
});

// O cargo @everyone usa o id do espaço.
const roles: Role[] = [
  role(space.id, DEFAULT_EVERYONE_PERMISSIONS),
  role('moderacao', MANAGE_CHANNELS),
  role('admin', ADMINISTRATOR),
  role('silenciado', 0),
  role('falante', 0),
];

const member = (userId: string, roleIds: string[] = []): Member => ({
  spaceId: space.id,
  userId,
  nickname: null,
  roleIds,
  joinedAt: '2026-01-01T00:00:00.000Z',
});

const channel = (overwrites: PermissionOverwrite[] = []): Channel => ({
  id: 'canal',
  spaceId: space.id,
  categoryId: null,
  name: 'canal',
  kind: 'text',
  position: 0,
  topic: null,
  overwrites,
});

const overwrite = (targetType: 'role' | 'member', targetId: string, allow: number, deny: number): PermissionOverwrite => ({
  targetType,
  targetId,
  allow,
  deny,
});

const channelPermissions = (m: Member, c: Channel) => computeChannelPermissions({ space, member: m, roles, channel: c });

describe('computeChannelPermissions', () => {
  it('dá ao dono todas as permissões, mesmo com sobrescrita negando', () => {
    const locked = channel([overwrite('member', 'dono', 0, VIEW_CHANNEL | SEND_MESSAGES)]);
    expect(channelPermissions(member('dono'), locked)).toBe(ALL_PERMISSIONS);
  });

  it('dá a um membro comum as permissões de @everyone', () => {
    expect(channelPermissions(member('ana'), channel())).toBe(DEFAULT_EVERYONE_PERMISSIONS);
  });

  it('deixa ADMINISTRATOR ignorar as sobrescritas', () => {
    const locked = channel([overwrite('role', space.id, 0, VIEW_CHANNEL)]);
    expect(channelPermissions(member('ana', ['admin']), locked)).toBe(ALL_PERMISSIONS);
  });

  it('aplica a sobrescrita de @everyone e deixa um cargo recuperar a permissão', () => {
    const readOnly = channel([
      overwrite('role', space.id, 0, SEND_MESSAGES),
      overwrite('role', 'moderacao', SEND_MESSAGES, 0),
    ]);
    expect(hasPermission(channelPermissions(member('ana'), readOnly), SEND_MESSAGES)).toBe(false);
    expect(hasPermission(channelPermissions(member('ana'), readOnly), VIEW_CHANNEL)).toBe(true);
    expect(hasPermission(channelPermissions(member('mod', ['moderacao']), readOnly), SEND_MESSAGES)).toBe(true);
  });

  it('entre cargos, a concessão vence a negação', () => {
    const c = channel([
      overwrite('role', 'silenciado', 0, SEND_MESSAGES),
      overwrite('role', 'falante', SEND_MESSAGES, 0),
    ]);
    expect(hasPermission(channelPermissions(member('ana', ['silenciado', 'falante']), c), SEND_MESSAGES)).toBe(true);
    expect(hasPermission(channelPermissions(member('bia', ['silenciado']), c), SEND_MESSAGES)).toBe(false);
  });

  it('deixa a sobrescrita do membro vencer a dos cargos', () => {
    const c = channel([
      overwrite('role', 'moderacao', SEND_MESSAGES, 0),
      overwrite('member', 'mod', 0, SEND_MESSAGES),
    ]);
    expect(hasPermission(channelPermissions(member('mod', ['moderacao']), c), SEND_MESSAGES)).toBe(false);
  });

  it('zera tudo quando o membro não pode ver o canal', () => {
    const hidden = channel([overwrite('role', space.id, 0, VIEW_CHANNEL)]);
    expect(channelPermissions(member('ana'), hidden)).toBe(0);
  });
});

describe('computeSpacePermissions', () => {
  it('soma @everyone e os cargos do membro, sem olhar canais', () => {
    const permissions = computeSpacePermissions({ space, member: member('mod', ['moderacao']), roles });
    expect(permissions).toBe(DEFAULT_EVERYONE_PERMISSIONS | MANAGE_CHANNELS);
  });

  it('só dá MANAGE_CHANNELS a quem tem cargo para isso, ao dono e a administradores', () => {
    const can = (m: Member) => hasPermission(computeSpacePermissions({ space, member: m, roles }), MANAGE_CHANNELS);
    expect(can(member('ana'))).toBe(false);
    expect(can(member('mod', ['moderacao']))).toBe(true);
    expect(can(member('dono'))).toBe(true);
    expect(can(member('adm', ['admin']))).toBe(true);
  });
});
