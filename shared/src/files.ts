// Arquivos anexados às mensagens: que tipo de arquivo é (para o ícone), se vale um aviso, e como falar deles.

import type { Attachment } from './models.js';
import { isImageAttachment } from './models.js';

export type FileKind = 'document' | 'sheet' | 'archive' | 'audio' | 'video' | 'code' | 'program' | 'other';

const KINDS: Record<Exclude<FileKind, 'other'>, string[]> = {
  document: ['pdf', 'doc', 'docx', 'odt', 'rtf', 'txt', 'md', 'ppt', 'pptx', 'odp', 'epub', 'log'],
  sheet: ['xls', 'xlsx', 'ods', 'csv', 'tsv'],
  archive: ['zip', 'rar', '7z', 'tar', 'gz', 'bz2', 'xz', 'tgz', 'iso'],
  audio: ['mp3', 'wav', 'ogg', 'flac', 'm4a', 'aac', 'opus', 'mid', 'midi'],
  video: ['mp4', 'mkv', 'mov', 'avi', 'webm', 'wmv', 'flv', 'm4v'],
  code: ['ts', 'tsx', 'jsx', 'json', 'py', 'java', 'c', 'cpp', 'h', 'cs', 'go', 'rs', 'html', 'css', 'xml', 'yml', 'yaml', 'sql', 'lua', 'php', 'rb'],
  // Rodam no computador de quem abrir: o cartão avisa para só abrir se confiar em quem enviou.
  program: ['exe', 'msi', 'bat', 'cmd', 'com', 'scr', 'ps1', 'vbs', 'vbe', 'wsf', 'jar', 'lnk', 'dll', 'apk', 'app', 'dmg', 'pkg', 'deb', 'sh', 'reg', 'hta', 'cpl', 'js', 'jse'],
};

const BY_EXTENSION = new Map<string, FileKind>(
  Object.entries(KINDS).flatMap(([kind, list]) => list.map((ext) => [ext, kind as FileKind] as const)),
);

/** A extensão do nome em minúsculas, sem o ponto (vazia se não tem). */
export const extensionOf = (name: string): string => {
  const dot = name.lastIndexOf('.');
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : '';
};

/**
 * O tipo do arquivo pela extensão do nome, só para escolher o ícone e o aviso. `program` são os que rodam no computador
 * de quem abrir (.exe, .bat, .jar, e também .js, que o Windows executa ao abrir com dois cliques).
 */
export const fileKind = (name: string): FileKind => BY_EXTENSION.get(extensionOf(name)) ?? 'other';

/** "1 imagem", "3 imagens", "1 arquivo", "2 arquivos" ou, com os dois tipos, "3 anexos". */
export function describeAttachments(list: readonly Attachment[]): string {
  const images = list.filter(isImageAttachment).length;
  const files = list.length - images;
  if (images > 0 && files > 0) return `${list.length} anexos`;
  if (files > 0) return files === 1 ? '1 arquivo' : `${files} arquivos`;
  return images === 1 ? '1 imagem' : `${images} imagens`;
}

/** O que dizer de quem mandou só anexos: "uma imagem", "um arquivo", "3 imagens", "3 anexos"... */
export function sentAttachments(list: readonly Attachment[]): string {
  if (list.length === 1) return isImageAttachment(list[0]!) ? 'uma imagem' : 'um arquivo';
  return describeAttachments(list);
}

/** "812 B", "4,2 KB", "18 MB", "1,3 GB". */
export function formatBytes(bytes: number): string {
  const units = ['B', 'KB', 'MB', 'GB'];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  const text = unit === 0 || value >= 100 ? String(Math.round(value)) : value.toFixed(1).replace(/\.0$/, '').replace('.', ',');
  return `${text} ${units[unit]}`;
}
