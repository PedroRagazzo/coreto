import type { Channel, Member, Role, Space } from '../../shared/src/models.js';
import { ALL_PERMISSIONS, Permission } from '../../shared/src/permissions.js';

interface SpacePermissionContext {
  space: Space;
  member: Member;
  roles: Role[];
}

interface PermissionContext extends SpacePermissionContext {
  channel: Channel;
}

/**
 * Permissões do membro no espaço como um todo, sem olhar sobrescritas de canal:
 * dono do espaço tem tudo; os demais somam @everyone e os próprios cargos, e
 * ADMINISTRATOR libera tudo. Usada para ações de gestão, como criar canais.
 */
export function computeSpacePermissions({ space, member, roles }: SpacePermissionContext): number {
  if (space.ownerId === member.userId) return ALL_PERMISSIONS;

  const rolesById = new Map(roles.map((role) => [role.id, role]));
  let permissions = rolesById.get(space.id)?.permissions ?? 0;
  for (const roleId of member.roleIds) permissions |= rolesById.get(roleId)?.permissions ?? 0;
  return permissions & Permission.ADMINISTRATOR ? ALL_PERMISSIONS : permissions;
}

/**
 * Resolve as permissões efetivas de um membro em um canal, nesta ordem:
 * 1. permissões do espaço (dono e ADMINISTRATOR já saem com tudo);
 * 2. sobrescrita do canal para @everyone;
 * 3. sobrescritas dos cargos do membro (negações somadas, depois concessões somadas);
 * 4. sobrescrita específica do membro.
 * Sem VIEW_CHANNEL o canal fica invisível e nenhuma outra permissão vale.
 */
export function computeChannelPermissions({ space, member, roles, channel }: PermissionContext): number {
  let permissions = computeSpacePermissions({ space, member, roles });
  if (permissions === ALL_PERMISSIONS) return ALL_PERMISSIONS;

  const everyone = channel.overwrites.find((o) => o.targetType === 'role' && o.targetId === space.id);
  if (everyone) permissions = (permissions & ~everyone.deny) | everyone.allow;

  let allow = 0;
  let deny = 0;
  for (const o of channel.overwrites) {
    if (o.targetType === 'role' && o.targetId !== space.id && member.roleIds.includes(o.targetId)) {
      allow |= o.allow;
      deny |= o.deny;
    }
  }
  permissions = (permissions & ~deny) | allow;

  const own = channel.overwrites.find((o) => o.targetType === 'member' && o.targetId === member.userId);
  if (own) permissions = (permissions & ~own.deny) | own.allow;

  return permissions & Permission.VIEW_CHANNEL ? permissions : 0;
}
