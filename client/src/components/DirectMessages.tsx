import { MessageCircle } from 'lucide-react';

// Mensagens diretas ainda não existem no backend: estes painéis só reservam o lugar no layout.

export function DirectMessagesSidebar() {
  return (
    <>
      <header className="flex h-12 shrink-0 items-center border-b border-line px-4 shadow-sm">
        <h1 className="font-semibold">Mensagens diretas</h1>
      </header>
      <div className="flex-1 p-4 text-sm text-muted">Nenhuma conversa ainda.</div>
    </>
  );
}

export function DirectMessagesPanel() {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 p-8 text-center">
      <MessageCircle size={48} className="text-faint" />
      <h2 className="text-lg font-semibold">Mensagens diretas</h2>
      <p className="max-w-sm text-muted">
        Conversas privadas entre duas pessoas ainda não foram implementadas neste protótipo. Escolha um espaço na barra
        à esquerda.
      </p>
    </div>
  );
}
