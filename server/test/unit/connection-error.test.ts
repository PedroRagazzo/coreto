import { describe, expect, it } from 'vitest';
import { describeConnectionError } from '../../../shared/src/connection-error.js';

describe('describeConnectionError', () => {
  it('troca os erros técnicos do socket por uma frase que diz o que tentar', () => {
    for (const raw of ['xhr poll error', 'websocket error', 'timeout', 'transport close', 'ping timeout', 'XHR Poll Error']) {
      const text = describeConnectionError(raw);
      expect(text).toContain('Não deu para alcançar o servidor');
      expect(text).not.toContain('xhr');
    }
  });

  it('sem internet, diz isso em vez do erro técnico', () => {
    expect(describeConnectionError('xhr poll error', false)).toBe('Você está sem internet.');
  });

  it('mantém as mensagens que o servidor mandou, que já são legíveis', () => {
    expect(describeConnectionError('Sessão inválida')).toBe('Sessão inválida');
  });

  it('não devolve nada quando não há erro', () => {
    expect(describeConnectionError(null)).toBeNull();
    expect(describeConnectionError(undefined)).toBeNull();
    expect(describeConnectionError('   ')).toBeNull();
  });
});
