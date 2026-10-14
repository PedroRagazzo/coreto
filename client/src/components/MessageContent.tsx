import { parseMarkup, type MarkupNode } from '@shared/markup';
import type { Attachment, Message } from '@shared/models';
import { ExternalLink, X } from 'lucide-react';
import { Fragment, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { formatMessageTime } from '../lib/format';
import { attachmentUrl } from '../lib/uploads';
import { useRealtime } from '../state/realtime';
import { displayNameOf } from '../state/selectors';

/** Maior caixa que uma imagem ocupa na conversa; a proporção é mantida. */
const PREVIEW_MAX = { width: 400, height: 300 };

/** Texto formatado da mensagem, o selo "(editada)" e as imagens. */
export function MessageContent({ message }: { message: Message }) {
  return (
    <>
      {(message.content || message.editedAt) && (
        <div className="text-[15px] leading-relaxed break-words whitespace-pre-wrap text-fg/95">
          <Markup content={message.content} />
          {message.editedAt && (
            <span className="ml-1 text-[10px] text-faint" title={`Editada em ${formatMessageTime(message.editedAt)}`}>
              (editada)
            </span>
          )}
        </div>
      )}
      {message.attachments.length > 0 && <AttachmentGallery attachments={message.attachments} />}
    </>
  );
}

/**
 * Só o texto formatado, sem imagens (ex.: citação no diálogo de apagar).
 * `highlight`: palavras já normalizadas (searchWords) a destacar no texto.
 */
export function Markup({ content, highlight = NO_HIGHLIGHT }: { content: string; highlight?: string[] }) {
  const nodes = useMemo(() => parseMarkup(content), [content]);
  return <MarkupNodes nodes={nodes} highlight={highlight} />;
}

const NO_HIGHLIGHT: string[] = [];

/** Caractere sem acento e minúsculo, para achar "acao" dentro de "Ação" mantendo as posições. */
const baseChar = (ch: string) => {
  const base = ch.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();
  return base.length === 1 ? base : ch.toLowerCase();
};

function highlightText(text: string, words: string[]): ReactNode {
  if (words.length === 0) return text;
  const chars = [...text];
  const folded = chars.map(baseChar);
  if (folded.some((ch) => ch.length !== 1)) return text; // caractere que vira dois: sem destaque
  const joined = folded.join('');
  const marked = new Array<boolean>(chars.length).fill(false);
  for (const word of words) {
    for (let at = joined.indexOf(word); at !== -1; at = joined.indexOf(word, at + 1)) {
      marked.fill(true, at, at + word.length);
    }
  }
  const parts: ReactNode[] = [];
  let start = 0;
  for (let i = 1; i <= chars.length; i++) {
    if (i < chars.length && marked[i] === marked[start]) continue;
    const piece = chars.slice(start, i).join('');
    parts.push(
      marked[start] ? (
        <mark key={start} className="rounded-sm bg-mention/30 text-fg">
          {piece}
        </mark>
      ) : (
        piece
      ),
    );
    start = i;
  }
  return parts;
}

function MarkupNodes({ nodes, highlight }: { nodes: MarkupNode[]; highlight: string[] }) {
  return nodes.map((node, i) => {
    // O bloco de código já é um bloco: a quebra de linha colada nele viraria uma linha em branco.
    if (node.type === 'text') {
      let text = node.text;
      if (nodes[i - 1]?.type === 'codeBlock') text = text.replace(/^\n/, '');
      if (nodes[i + 1]?.type === 'codeBlock') text = text.replace(/\n$/, '');
      return <Fragment key={i}>{highlightText(text, highlight)}</Fragment>;
    }
    return <Fragment key={i}>{renderNode(node, highlight)}</Fragment>;
  });
}

function renderNode(node: MarkupNode, highlight: string[]): ReactNode {
  switch (node.type) {
    case 'text':
      return node.text;
    case 'bold':
      return (
        <strong className="font-semibold text-fg">
          <MarkupNodes nodes={node.children} highlight={highlight} />
        </strong>
      );
    case 'italic':
      return (
        <em>
          <MarkupNodes nodes={node.children} highlight={highlight} />
        </em>
      );
    case 'strike':
      return (
        <s className="text-muted">
          <MarkupNodes nodes={node.children} highlight={highlight} />
        </s>
      );
    case 'code':
      return <code className="rounded bg-rail px-1 py-0.5 font-mono text-[13px]">{node.text}</code>;
    case 'codeBlock':
      return (
        <pre
          className="my-1 overflow-x-auto rounded-md border border-line bg-rail px-3 py-2 font-mono text-[13px] leading-5 whitespace-pre"
          data-language={node.language ?? undefined}
        >
          <code>{node.text}</code>
        </pre>
      );
    case 'link':
      return (
        <a href={node.url} target="_blank" rel="noopener noreferrer nofollow ugc" className="text-link hover:underline">
          {node.url}
        </a>
      );
    case 'mention':
      return <Mention userId={node.userId} />;
  }
}

function Mention({ userId }: { userId: string }) {
  const { state } = useRealtime();
  const known = Boolean(state.users[userId]);
  const mine = userId === state.me?.id;
  return (
    <span
      className={`rounded px-0.5 font-medium ${mine ? 'bg-mention/25 text-mention' : 'bg-accent/15 text-accent'}`}
      title={known ? undefined : 'Usuário que não está neste espaço'}
    >
      @{known ? displayNameOf(state.snapshot, state.users, userId) : 'desconhecido'}
    </span>
  );
}

/** Tamanho de exibição que cabe em PREVIEW_MAX; reservado antes de a imagem carregar. */
function previewSize({ width, height }: Attachment): { width: number; height: number } {
  const scale = Math.min(1, PREVIEW_MAX.width / width, PREVIEW_MAX.height / height);
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

function AttachmentGallery({ attachments }: { attachments: Attachment[] }) {
  const [viewing, setViewing] = useState<Attachment | null>(null);
  return (
    <div className="mt-1 flex flex-wrap gap-2">
      {attachments.map((attachment) => {
        const size = previewSize(attachment);
        return (
          <button
            key={attachment.id}
            type="button"
            onClick={() => setViewing(attachment)}
            title={attachment.fileName}
            className="max-w-full overflow-hidden rounded-md bg-rail focus-visible:outline-2 focus-visible:outline-accent"
            style={{ width: size.width, aspectRatio: `${size.width} / ${size.height}` }}
          >
            <img
              src={attachmentUrl(attachment)}
              alt={attachment.fileName}
              width={size.width}
              height={size.height}
              loading="lazy"
              className="h-full w-full object-cover"
            />
          </button>
        );
      })}
      {viewing && <ImageViewer attachment={viewing} onClose={() => setViewing(null)} />}
    </div>
  );
}

/** Imagem em tela cheia sobre o `<dialog>` nativo: Esc ou clique fora fecham. */
function ImageViewer({ attachment, onClose }: { attachment: Attachment; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    if (dialog && !dialog.open) dialog.showModal();
  }, []);
  const url = attachmentUrl(attachment);

  return (
    <dialog
      ref={ref}
      aria-label={attachment.fileName}
      onClose={onClose}
      onClick={(e) => e.target === e.currentTarget && onClose()}
      className="m-auto max-h-none max-w-none bg-transparent p-0 backdrop:bg-black/80"
    >
      <figure className="flex flex-col items-center gap-2" onClick={(e) => e.target === e.currentTarget && onClose()}>
        <img
          src={url}
          alt={attachment.fileName}
          className="max-h-[85vh] max-w-[calc(100vw-32px)] rounded-md object-contain"
        />
        <figcaption className="flex items-center gap-3 text-sm text-muted">
          <span className="max-w-[60vw] truncate">{attachment.fileName}</span>
          <span>
            {attachment.width}×{attachment.height}
          </span>
          <a href={url} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1 text-link hover:underline">
            Abrir original <ExternalLink size={13} />
          </a>
          <button type="button" onClick={onClose} aria-label="Fechar" className="rounded p-1 hover:text-fg" autoFocus>
            <X size={16} />
          </button>
        </figcaption>
      </figure>
    </dialog>
  );
}
