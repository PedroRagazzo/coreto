import { firstLink } from '@shared/links';
import type { LinkPreview, Message } from '@shared/models';
import { useEffect, useMemo } from 'react';
import { embedImageUrl } from '../lib/uploads';
import { useRealtime } from '../state/realtime';
import { useSettings } from '../state/settings';

/** Maior caixa que uma imagem de link ocupa; a proporção é mantida. */
const IMAGE_MAX = { width: 400, height: 300 };
/** Proporção das imagens de destaque das páginas quando o site não diz o tamanho (a mais comum, 1,91:1). */
const DEFAULT_RATIO = 1.91;

/** Encaixa a imagem na caixa sem ampliar, para a mensagem já ter a altura certa antes de a imagem carregar. */
function fit(width: number | null, height: number | null): { width: number; height: number } | null {
  if (!width || !height) return null;
  const scale = Math.min(1, IMAGE_MAX.width / width, IMAGE_MAX.height / height);
  return { width: Math.round(width * scale), height: Math.round(height * scale) };
}

/**
 * O cartão do primeiro link da mensagem: título, descrição e imagem da página, ou a própria imagem (ou GIF) quando o
 * link é uma. O servidor busca a página; o navegador só carrega a imagem pelo próprio servidor do Coreto.
 */
export function LinkPreviewCard({ message }: { message: Message }) {
  const { state, actions } = useRealtime();
  const enabled = useSettings().settings.appearance.linkPreviews;
  const url = useMemo(() => firstLink(message.content), [message.content]);
  const known = url ? state.linkPreviews[url] : undefined;

  useEffect(() => {
    if (enabled && url && known === undefined) actions.requestLinkPreview(message);
  }, [enabled, url, known, message, actions]);

  if (!enabled || !url || !known) return null;
  return known.kind === 'image' ? <ImageLink preview={known} /> : <PageCard preview={known} />;
}

function ImageLink({ preview }: { preview: LinkPreview }) {
  const image = preview.image!;
  const size = fit(image.width, image.height);
  return (
    <a href={preview.url} target="_blank" rel="noopener noreferrer nofollow ugc" className="mt-1 block w-fit max-w-full">
      <img
        src={embedImageUrl(image.id)}
        alt={`Imagem de ${preview.siteName ?? 'um link'}`}
        loading="lazy"
        decoding="async"
        {...(size ? { width: size.width, height: size.height } : { style: { maxWidth: IMAGE_MAX.width, maxHeight: IMAGE_MAX.height } })}
        className="max-w-full rounded-lg border border-line object-contain"
      />
    </a>
  );
}

function PageCard({ preview }: { preview: LinkPreview }) {
  const { image } = preview;
  const ratio = image?.width && image.height ? image.width / image.height : DEFAULT_RATIO;
  return (
    <div className="mt-1 max-w-md overflow-hidden rounded-lg border border-l-4 border-line border-l-accent bg-rail/60 p-3">
      {preview.siteName && <p className="truncate text-xs text-faint">{preview.siteName}</p>}
      {preview.title && (
        <a
          href={preview.url}
          target="_blank"
          rel="noopener noreferrer nofollow ugc"
          className="mt-0.5 block text-[15px] leading-snug font-semibold break-words text-link hover:underline"
        >
          {preview.title}
        </a>
      )}
      {preview.description && <p className="mt-1 line-clamp-3 text-sm break-words text-muted">{preview.description}</p>}
      {image && (
        <a href={preview.url} target="_blank" rel="noopener noreferrer nofollow ugc" tabIndex={-1} className="mt-2 block">
          <img
            src={embedImageUrl(image.id)}
            alt=""
            loading="lazy"
            decoding="async"
            style={{ aspectRatio: String(Math.min(Math.max(ratio, 0.6), 2.5)) }}
            className="max-h-72 w-full rounded-md object-cover"
          />
        </a>
      )}
    </div>
  );
}
