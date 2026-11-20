// O registro das quedas de conexão de um aparelho: quando caiu, por quê, se estava numa chamada e em quanto tempo voltou.
//
// Cair da chamada "do nada" quase sempre vem da rede de quem caiu, e o servidor não sabe o motivo (só vê o socket sumir).
// O próprio aparelho sabe, então ele anota e a tela de Diagnóstico mostra, para dar para comparar entre as pessoas.

export interface ConnectionDrop {
  /** Quando caiu (ms desde 1970). */
  at: number;
  /** O motivo que o socket.io deu ("ping timeout", "transport close"…). */
  reason: string;
  inCall: boolean;
  /** O app estava em segundo plano (aba escondida, tela bloqueada). */
  hidden: boolean;
  /** O aparelho dizia estar sem internet. */
  offline: boolean;
  /** O tipo de rede que o aparelho informou ("4g", "wifi"…), quando informa. */
  network?: string;
  /** Em quantos ms a conexão voltou; vazio enquanto não voltou. */
  backMs?: number;
}

/** Quantas quedas ficam guardadas. */
export const MAX_DROPS = 20;

const REASONS: Record<string, string> = {
  'ping timeout': 'o aparelho parou de responder ao servidor (internet instável ou app em segundo plano)',
  'transport close': 'a conexão foi cortada no caminho (rede, troca de Wi-Fi/dados ou algo entre o aparelho e o servidor)',
  'transport error': 'falha na rede durante a conexão',
};

export function explainDropReason(reason: string): string {
  return REASONS[reason] ?? reason;
}

/** Põe a queda nova no fim e guarda só as últimas `MAX_DROPS`. */
export function addDrop(list: ConnectionDrop[], drop: ConnectionDrop): ConnectionDrop[] {
  return [...list, drop].slice(-MAX_DROPS);
}

/** A conexão voltou em `now`: anota o tempo na última queda que ainda estava aberta. */
export function markBack(list: ConnectionDrop[], now: number): ConnectionDrop[] {
  let index = -1;
  for (let i = list.length - 1; i >= 0; i -= 1) {
    if (list[i].backMs === undefined) {
      index = i;
      break;
    }
  }
  if (index < 0) return list;
  return list.map((d, i) => (i === index ? { ...d, backMs: Math.max(0, now - d.at) } : d));
}

/** Uma linha de texto para a tela e para copiar (sem a hora, que cada tela formata do seu jeito). */
export function describeDrop(drop: ConnectionDrop): string {
  const parts = [drop.inCall ? 'numa chamada' : 'fora de chamada', `motivo: ${drop.reason}`];
  if (drop.offline) parts.push('o aparelho estava sem internet');
  if (drop.hidden) parts.push('o app estava em segundo plano');
  if (drop.network) parts.push(`rede: ${drop.network}`);
  parts.push(drop.backMs === undefined ? 'ainda não voltou' : `voltou em ${Math.max(1, Math.round(drop.backMs / 1000))} s`);
  return parts.join(' · ');
}
