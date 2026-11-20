import { describe, expect, it } from 'vitest';
import {
  addDrop,
  describeDrop,
  explainDropReason,
  markBack,
  MAX_DROPS,
  type ConnectionDrop,
} from '../../../shared/src/connection-drops.js';

const drop = (over: Partial<ConnectionDrop> = {}): ConnectionDrop => ({
  at: 1_000,
  reason: 'ping timeout',
  inCall: true,
  hidden: false,
  offline: false,
  ...over,
});

describe('explainDropReason', () => {
  it('explica o ping timeout como o aparelho que parou de responder', () => {
    expect(explainDropReason('ping timeout')).toMatch(/parou de responder/);
  });

  it('explica transport close como conexão cortada no caminho', () => {
    expect(explainDropReason('transport close')).toMatch(/cortada/);
  });

  it('explica o transport error como falha de rede', () => {
    expect(explainDropReason('transport error')).toMatch(/rede/);
  });

  it('um motivo que não conhece volta como veio', () => {
    expect(explainDropReason('coisa nova')).toBe('coisa nova');
  });
});

describe('addDrop', () => {
  it('põe a queda nova no fim e guarda só as últimas', () => {
    let list: ConnectionDrop[] = [];
    for (let i = 0; i < MAX_DROPS + 5; i += 1) list = addDrop(list, drop({ at: i }));
    expect(list).toHaveLength(MAX_DROPS);
    expect(list[0].at).toBe(5);
    expect(list.at(-1)?.at).toBe(MAX_DROPS + 4);
  });
});

describe('markBack', () => {
  it('anota quanto a conexão demorou para voltar na última queda ainda aberta', () => {
    const list = markBack([drop({ at: 1_000 })], 4_500);
    expect(list[0].backMs).toBe(3_500);
  });

  it('não mexe numa queda que já voltou', () => {
    const list = markBack([drop({ at: 1_000, backMs: 2_000 })], 9_000);
    expect(list[0].backMs).toBe(2_000);
  });

  it('sem nenhuma queda, não faz nada', () => {
    expect(markBack([], 5_000)).toEqual([]);
  });
});

describe('describeDrop', () => {
  it('diz se foi numa chamada, o motivo e em quanto tempo voltou', () => {
    const text = describeDrop(drop({ backMs: 4_000 }));
    expect(text).toContain('numa chamada');
    expect(text).toContain('ping timeout');
    expect(text).toContain('voltou em 4 s');
  });

  it('avisa quando o aparelho estava sem internet ou com o app em segundo plano', () => {
    expect(describeDrop(drop({ offline: true }))).toContain('sem internet');
    expect(describeDrop(drop({ hidden: true }))).toContain('em segundo plano');
  });

  it('uma queda que ainda não voltou diz que ainda não voltou', () => {
    expect(describeDrop(drop())).toContain('ainda não voltou');
  });
});
