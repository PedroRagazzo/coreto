import { fileKind, formatBytes } from '@shared/files';
import type { Attachment } from '@shared/models';
import { Download, ShieldAlert } from 'lucide-react';
import { attachmentUrl } from '../lib/uploads';
import { FileIcon } from './FileIcon';

/** Os arquivos de uma mensagem (os que não são imagem): um cartão por arquivo, com nome, tamanho e o botão de baixar. */
export function FileList({ files }: { files: Attachment[] }) {
  return (
    <ul aria-label="Arquivos" className="mt-1 flex flex-col gap-1.5">
      {files.map((file) => (
        <FileCard key={file.id} file={file} />
      ))}
    </ul>
  );
}

function FileCard({ file }: { file: Attachment }) {
  const program = fileKind(file.fileName) === 'program';
  return (
    <li className="w-full max-w-sm">
      {/* O servidor responde com "attachment": o navegador baixa em vez de abrir. */}
      <a
        href={attachmentUrl(file)}
        download={file.fileName}
        title={program ? `${file.fileName}: é um programa. Só abra se confiar em quem enviou.` : `Baixar ${file.fileName}`}
        className="group flex items-center gap-3 rounded-lg border border-line bg-rail/60 p-3 hover:border-accent/60 hover:bg-hover/60 focus-visible:outline-2 focus-visible:outline-accent"
      >
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-elevated text-muted">
          <FileIcon name={file.fileName} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium text-link group-hover:underline">{file.fileName}</span>
          <span className="flex items-center gap-1 text-xs text-faint">
            {formatBytes(file.size)}
            {program && (
              <>
                <span aria-hidden>·</span>
                <ShieldAlert size={12} className="text-idle" aria-hidden />
                <span className="text-idle">programa: só abra se confiar</span>
              </>
            )}
          </span>
        </span>
        <Download size={18} className="shrink-0 text-muted group-hover:text-fg" aria-label="Baixar" />
      </a>
    </li>
  );
}
