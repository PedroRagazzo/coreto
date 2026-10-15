import { Download } from 'lucide-react';
import { SERVER_URL } from '../lib/socket';

/** O servidor redireciona /download para o instalador da última release (ver server/src/download.ts). */
export const DOWNLOAD_URL = `${SERVER_URL}/download`;

export function DownloadApp({ variant = 'primary' }: { variant?: 'primary' | 'subtle' }) {
  return (
    <a
      href={DOWNLOAD_URL}
      className={`flex w-full items-center justify-center gap-2 rounded-md py-2.5 font-semibold ${
        variant === 'primary' ? 'bg-accent text-white hover:bg-accent-strong' : 'bg-elevated hover:bg-hover'
      }`}
    >
      <Download size={18} />
      Baixar para Windows
    </a>
  );
}
