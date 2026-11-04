// O estado em tempo real do site. Quem usa importa daqui (`state/realtime`); como o código está dividido em partes,
// veja o comentário de provider.tsx.

export { RealtimeProvider, useRealtime } from './provider';
export type { RealtimeState } from './state';
