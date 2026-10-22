// Links dentro de mensagens: só o primeiro ganha pré-visualização. Vem da mesma leitura de markup.ts que pinta o link
// como clicável na mensagem, então o cartão é sempre do link que a pessoa vê (e nunca de um link dentro de código).

import { parseMarkup, type MarkupNode } from './markup.js';

export const MAX_LINK_LENGTH = 2000;

function find(nodes: MarkupNode[]): string | null {
  for (const node of nodes) {
    if (node.type === 'link') return node.url;
    if (node.type === 'bold' || node.type === 'italic' || node.type === 'strike') {
      const inner = find(node.children);
      if (inner) return inner;
    }
  }
  return null;
}

/** O primeiro link http(s) da mensagem como aparece nela, sem a pontuação da frase; `null` se não há. */
export function firstLink(content: string): string | null {
  const url = find(parseMarkup(content));
  return url && url.length <= MAX_LINK_LENGTH ? url : null;
}
