// Os cookies do YouTube chegam como um arquivo montado no container, quase sempre somente leitura e às
// vezes de outro dono. O yt-dlp regrava o arquivo ao terminar (o YouTube troca os cookies a cada uso), então
// ele trabalha numa cópia na pasta temporária: lá ele pode gravar, e a sessão renovada vale até o container
// reiniciar (depois disso, volta ao arquivo original).

import { copyFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export class CookieJar {
  private readonly copy = join(tmpdir(), `coreto-yt-cookies-${process.pid}.txt`);
  private copiedFrom: number | null = null;
  private warned = false;

  constructor(private readonly original: string | null) {}

  /** Caminho da cópia de trabalho (criada ou atualizada se o arquivo original mudou), ou `null` sem cookies. */
  path(): string | null {
    if (!this.original) return null;
    try {
      const modified = statSync(this.original).mtimeMs;
      if (this.copiedFrom !== modified) {
        copyFileSync(this.original, this.copy);
        this.copiedFrom = modified;
      }
      return this.copy;
    } catch (err) {
      if (!this.warned) {
        this.warned = true;
        console.warn(`[música] não consegui ler o arquivo de cookies (${this.original}):`, (err as Error).message);
      }
      return null;
    }
  }
}
