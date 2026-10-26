import { fileKind, type FileKind } from '@shared/files';
import {
  File,
  FileArchive,
  FileAudio,
  FileCode,
  FileSpreadsheet,
  FileText,
  FileVideo,
  Terminal,
  type LucideIcon,
} from 'lucide-react';

const ICONS: Record<FileKind, LucideIcon> = {
  document: FileText,
  sheet: FileSpreadsheet,
  archive: FileArchive,
  audio: FileAudio,
  video: FileVideo,
  code: FileCode,
  program: Terminal,
  other: File,
};

/** O ícone do tipo do arquivo, escolhido pela extensão do nome. */
export function FileIcon({ name, size = 22, className }: { name: string; size?: number; className?: string }) {
  const Icon = ICONS[fileKind(name)];
  return <Icon size={size} className={className} aria-hidden />;
}
