// Quanto do disco onde os dados moram já está ocupado. O /health mostra esse número para o monitor de fora (GitHub
// Actions, `deploy/monitor/`) avisar antes de o disco encher, o que derrubaria o banco e os anexos de uma vez.

import { statfs } from 'node:fs/promises';

export interface DiskUsage {
  /** Percentual ocupado do sistema de arquivos, de 0 a 100 (uma casa decimal). */
  usedPercent: number;
  freeBytes: number;
  totalBytes: number;
}

/**
 * Lê o sistema de arquivos que guarda `dir`. Num volume do Docker, é o disco da própria VPS. Devolve `null` se não der
 * para ler (pasta que não existe, sistema sem `statfs`): o /health segue respondendo sem o número.
 */
export async function diskUsage(dir: string): Promise<DiskUsage | null> {
  try {
    const stats = await statfs(dir);
    const totalBytes = stats.blocks * stats.bsize;
    if (totalBytes <= 0) return null;
    // `bavail` é o que um processo comum ainda consegue gravar (descontada a reserva do root), como o `df` mostra.
    const freeBytes = stats.bavail * stats.bsize;
    const usedPercent = Math.round(((totalBytes - freeBytes) / totalBytes) * 1000) / 10;
    return { usedPercent, freeBytes, totalBytes };
  } catch {
    return null;
  }
}
