// Permissões como bit flags: um cargo guarda a soma (OR) das que concede.

export const Permission = {
  /** Ler: ver o canal e o histórico de mensagens. */
  VIEW_CHANNEL: 1 << 0,
  /** Escrever: enviar mensagens em canais de texto. */
  SEND_MESSAGES: 1 << 1,
  /** Conectar: entrar em canais de voz. */
  CONNECT: 1 << 2,
  /** Falar com o microfone aberto em canais de voz. */
  SPEAK: 1 << 3,
  MANAGE_MESSAGES: 1 << 4,
  MANAGE_CHANNELS: 1 << 5,
  MANAGE_ROLES: 1 << 6,
  /** Compartilhar a tela em canais de voz. */
  STREAM: 1 << 7,
  /** Ignora todas as sobrescritas de canal. */
  ADMINISTRATOR: 1 << 30,
} as const;

export type PermissionName = keyof typeof Permission;

export const ALL_PERMISSIONS = Object.values(Permission).reduce((acc, flag) => acc | flag, 0);

export const DEFAULT_EVERYONE_PERMISSIONS =
  Permission.VIEW_CHANNEL | Permission.SEND_MESSAGES | Permission.CONNECT | Permission.SPEAK | Permission.STREAM;

export function hasPermission(permissions: number, flag: number): boolean {
  return (permissions & flag) === flag;
}
