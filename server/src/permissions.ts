import type { Channel, Member, Role, Space } from '../../shared/src/models.js';
import { ALL_PERMISSIONS, Permission } from '../../shared/src/permissions.js';

interface PermissionContext {
  space: Space;
  member: Member;
  roles: Role[];
  channel: Channel;
}

/**
 * Resolve as permissões efetivas de um membro em um canal, nesta ordem:
 * 1. dono do espaço: tudo;
 * 2. base = @everyone ∪ cargos do membro; com ADMINISTRATOR: tudo;
 * 3. sobrescrita do canal para @everyone;
 * 4. sobrescritas dos cargos do membro (negações somadas, depois concessões somadas);
 * 5. sobrescrita específica do membro.
 * Sem VIEW_CHANNEL o canal fica invisível e nenhuma outra permissão vale.
 */
export function computeChannelPermissions({ space, member, roles, channel }: PermissionContext): number {
  if (space.ownerId === member.userId) return ALL_PERMISSIONS;

  const rolesById = new Map(roles.map((role) => [role.id, role]));
  let permissions = rolesById.get(space.id)?.permissions ?? 0;
  for (const roleId of member.roleIds) permissions |= rolesById.get(roleId)?.permissions ?? 0;
  if (permissions & Permission.ADMINISTRATOR) return ALL_PERMISSIONS;

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
