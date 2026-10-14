import { useEffect, useId, useRef, type ReactNode } from 'react';

export const labelClass = 'block text-xs font-semibold tracking-wide text-muted uppercase';
export const fieldClass =
  'mt-2 w-full rounded-md bg-rail px-3 py-2.5 text-fg outline-none placeholder:text-faint focus:ring-2 focus:ring-accent';

interface ModalProps {
  title: string;
  description?: string;
  onClose: () => void;
  children: ReactNode;
}

/**
 * Diálogo modal sobre o `<dialog>` nativo: o navegador cuida do foco preso,
 * da tecla Esc e do fundo. Monte só enquanto estiver aberto.
 * Marque o campo que deve receber o foco com `data-autofocus`: o `showModal()`
 * focaria o primeiro elemento focável e anularia o `autoFocus` do React.
 */
export function Modal({ title, description, onClose, children }: ModalProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog || dialog.open) return;
    dialog.showModal();
    dialog.querySelector<HTMLElement>('[data-autofocus]')?.focus();
  }, []);

  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      onClose={onClose}
      // Clique fora do conteúdo (no fundo) fecha.
      onClick={(e) => e.target === ref.current && onClose()}
      className="m-auto w-[min(460px,calc(100vw-32px))] rounded-xl bg-panel p-0 text-fg shadow-2xl backdrop:bg-black/60"
    >
      <div className="p-6">
        <h2 id={titleId} className="text-xl font-bold">
          {title}
        </h2>
        {description && <p className="mt-1 text-sm text-muted">{description}</p>}
        <div className="mt-5">{children}</div>
      </div>
    </dialog>
  );
}

interface DialogActionsProps {
  onCancel: () => void;
  submitLabel: string;
  disabled: boolean;
  /** Ação destrutiva: botão principal em vermelho. */
  danger?: boolean;
  /** Conteúdo alinhado à esquerda, como um botão secundário de excluir. */
  leading?: ReactNode;
}

export function DialogActions({ onCancel, submitLabel, disabled, danger = false, leading }: DialogActionsProps) {
  return (
    <div className="mt-6 flex items-center gap-2">
      <div className="mr-auto">{leading}</div>
      <button type="button" onClick={onCancel} className="rounded-md px-4 py-2 text-sm font-medium text-muted hover:text-fg">
        Cancelar
      </button>
      <button
        type="submit"
        disabled={disabled}
        className={`rounded-md px-4 py-2 text-sm font-semibold text-white disabled:opacity-50 ${
          danger ? 'bg-dnd hover:bg-dnd/85' : 'bg-accent hover:bg-accent-strong'
        }`}
      >
        {submitLabel}
      </button>
    </div>
  );
}
