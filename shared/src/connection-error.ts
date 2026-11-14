// Texto amigável para os erros de conexão do socket.
//
// O socket.io devolve mensagens técnicas ("xhr poll error", "websocket error", "timeout"). Quem vê "xhr poll error" no
// aviso não sabe o que fazer; esta função troca por uma frase que diz o que houve e o que tentar. Erros que o próprio
// servidor mandou (ex.: sessão inválida) já são frases legíveis e passam como estão.

/** Erros de transporte do socket.io/engine.io: a rede ou algo no caminho (VPN, antivírus, proxy) impediu de chegar. */
const TRANSPORT_ERRORS = new Set([
  'xhr poll error',
  'xhr post error',
  'websocket error',
  'transport error',
  'transport close',
  'transport unknown',
  'timeout',
  'ping timeout',
  'poll error',
  'parse error',
]);

export function describeConnectionError(message: string | null | undefined, online = true): string | null {
  const text = message?.trim();
  if (!text) return null;
  if (!online) return 'Você está sem internet.';
  if (TRANSPORT_ERRORS.has(text.toLowerCase())) {
    return 'Não deu para alcançar o servidor. Confira a sua internet; se usa VPN, antivírus ou firewall, ele pode estar bloqueando.';
  }
  return text;
}
