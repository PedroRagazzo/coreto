import type { Id } from '@shared/models';
import type { RealtimeState } from '../state';

export function withoutKey<T>(record: Record<Id, T> | undefined, key: Id): Record<Id, T> {
  const { [key]: _removed, ...rest } = record ?? {};
  return rest;
}

/** O que muda ao fechar uma transmissão aberta; se era a em destaque, o destaque passa para a última que sobrou. */
export function closeStage(state: RealtimeState, userId: Id): Pick<RealtimeState, 'stages' | 'focusedStage'> {
  if (!state.stages.includes(userId)) return { stages: state.stages, focusedStage: state.focusedStage };
  const stages = state.stages.filter((id) => id !== userId);
  const focusedStage = state.focusedStage === userId ? (stages[stages.length - 1] ?? null) : state.focusedStage;
  return { stages, focusedStage };
}
