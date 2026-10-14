// Formatação leve das mensagens (um pedaço do Markdown) e menções.
//
// O conteúdo guardado é texto puro; menções ficam como `<@idDoUsuário>`. O
// servidor usa a árvore para saber quem foi mencionado, e o cliente monta
// elementos React a partir dela — nunca HTML, então não há como injetar marcação.
//
//   **negrito**  *itálico*  _itálico_  ~~riscado~~  `código`  ```bloco```
//   links http(s) viram clicáveis; `\*` escapa um caractere especial.

import type { Id } from './models.js';

export type MarkupNode =
  | { type: 'text'; text: string }
  | { type: 'bold' | 'italic' | 'strike'; children: MarkupNode[] }
  | { type: 'code'; text: string }
  | { type: 'codeBlock'; text: string; language: string | null }
  | { type: 'link'; url: string }
  | { type: 'mention'; userId: Id };

const FENCE = /```(?:([\w+#-]{1,20})\n)?([\s\S]*?)```/g;
const WORD_CHAR = /[\p{L}\p{N}_]/u;
/** Só estes caracteres podem começar uma regra; o resto vai direto para o texto. */
const RULE_STARTS = new Set(['\\', '`', '*', '_', '~', '<', 'h']);

interface Rule {
  pattern: RegExp;
  /** Só vale no começo de uma palavra (para `snake_case_name` não virar itálico). */
  wordStart?: boolean;
  read(match: RegExpExecArray): { node: MarkupNode; length: number } | null;
}

const whole = (node: MarkupNode, match: RegExpExecArray) => ({ node, length: match[0].length });

const RULES: Rule[] = [
  { pattern: /\\([\\`*_~<])/y, read: (m) => whole({ type: 'text', text: m[1] }, m) },
  { pattern: /`([^`\n]+)`/y, read: (m) => whole({ type: 'code', text: m[1] }, m) },
  { pattern: /<@([\w-]{1,64})>/y, read: (m) => whole({ type: 'mention', userId: m[1] }, m) },
  { pattern: /https?:\/\/[^\s<>]+/y, read: (m) => readLink(m[0]) },
  { pattern: /\*\*(?=\S)([\s\S]*?\S)\*\*(?!\*)/y, read: (m) => whole({ type: 'bold', children: parseInline(m[1]) }, m) },
  { pattern: /~~(?=\S)([\s\S]*?\S)~~/y, read: (m) => whole({ type: 'strike', children: parseInline(m[1]) }, m) },
  { pattern: /\*(?=[^\s*])([\s\S]*?[^\s*])\*(?!\*)/y, read: (m) => whole({ type: 'italic', children: parseInline(m[1]) }, m) },
  {
    pattern: /_(?=\S)([\s\S]*?\S)_(?![\p{L}\p{N}_])/uy,
    wordStart: true,
    read: (m) => whole({ type: 'italic', children: parseInline(m[1]) }, m),
  },
];

/**
 * Pontuação no fim de um link quase sempre é da frase ("veja https://x.com.").
 * Um ")" final só fica se fechar um "(" do próprio link (links da Wikipédia).
 */
function readLink(raw: string): { node: MarkupNode; length: number } | null {
  let url = raw;
  for (;;) {
    const last = url.at(-1)!;
    const unbalanced = last === ')' && url.split('(').length <= url.split(')').length - 1;
    if (!'.,:;!?\'"]'.includes(last) && !unbalanced) break;
    url = url.slice(0, -1);
  }
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
  } catch {
    return null;
  }
  return { node: { type: 'link', url }, length: url.length };
}

function pushText(nodes: MarkupNode[], text: string): void {
  if (!text) return;
  const last = nodes.at(-1);
  if (last?.type === 'text') last.text += text;
  else nodes.push({ type: 'text', text });
}

function parseInline(source: string): MarkupNode[] {
  const nodes: MarkupNode[] = [];
  let plain = '';
  let i = 0;
  scan: while (i < source.length) {
    if (RULE_STARTS.has(source[i])) {
      for (const rule of RULES) {
        if (rule.wordStart && i > 0 && WORD_CHAR.test(source[i - 1])) continue;
        rule.pattern.lastIndex = i;
        const match = rule.pattern.exec(source);
        const result = match && rule.read(match);
        if (!result) continue;
        pushText(nodes, plain);
        plain = '';
        if (result.node.type === 'text') pushText(nodes, result.node.text);
        else nodes.push(result.node);
        i += result.length;
        continue scan;
      }
    }
    plain += source[i++];
  }
  pushText(nodes, plain);
  return nodes;
}

/** Transforma o conteúdo de uma mensagem em árvore de formatação. */
export function parseMarkup(source: string): MarkupNode[] {
  const nodes: MarkupNode[] = [];
  let last = 0;
  for (const match of source.matchAll(FENCE)) {
    for (const node of parseInline(source.slice(last, match.index))) {
      if (node.type === 'text') pushText(nodes, node.text);
      else nodes.push(node);
    }
    // A quebra de linha logo depois da abertura e logo antes do fechamento é só moldura.
    nodes.push({ type: 'codeBlock', language: match[1] ?? null, text: match[2].replace(/^\n/, '').replace(/\n$/, '') });
    last = match.index + match[0].length;
  }
  for (const node of parseInline(source.slice(last))) {
    if (node.type === 'text') pushText(nodes, node.text);
    else nodes.push(node);
  }
  return nodes;
}

/** Ids mencionados no conteúdo, sem repetição, na ordem em que aparecem. Menções dentro de código não contam. */
export function mentionedUserIds(content: string): Id[] {
  const ids = new Set<Id>();
  const walk = (nodes: MarkupNode[]) => {
    for (const node of nodes) {
      if (node.type === 'mention') ids.add(node.userId);
      else if (node.type === 'bold' || node.type === 'italic' || node.type === 'strike') walk(node.children);
    }
  };
  walk(parseMarkup(content));
  return [...ids];
}

export interface MentionCandidate {
  id: Id;
  name: string;
}

/**
 * Troca `@Nome` (sem diferenciar maiúsculas) pela forma guardada, `<@id>`.
 * Nomes mais longos têm prioridade: "@Ana Clara" não vira "@Ana" + " Clara".
 */
export function encodeMentions(text: string, candidates: MentionCandidate[]): string {
  const sorted = [...candidates].filter((c) => c.name).sort((a, b) => b.name.length - a.name.length);
  let out = '';
  let i = 0;
  while (i < text.length) {
    if (text[i] === '@' && (i === 0 || !WORD_CHAR.test(text[i - 1]))) {
      const found = sorted.find((c) => {
        const end = i + 1 + c.name.length;
        return (
          text.slice(i + 1, end).toLocaleLowerCase() === c.name.toLocaleLowerCase() &&
          (end === text.length || !WORD_CHAR.test(text[end]))
        );
      });
      if (found) {
        out += `<@${found.id}>`;
        i += 1 + found.name.length;
        continue;
      }
    }
    out += text[i++];
  }
  return out;
}

/** O inverso de `encodeMentions`, para editar: `<@id>` volta a ser `@Nome`. Ids desconhecidos ficam como estão. */
export function decodeMentions(content: string, nameOf: (userId: Id) => string | null): string {
  return content.replace(/<@([\w-]{1,64})>/g, (raw, id: string) => {
    const name = nameOf(id);
    return name ? `@${name}` : raw;
  });
}
