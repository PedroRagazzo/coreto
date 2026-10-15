// O botão "Baixar o app" do site aponta para /download, que redireciona para o
// instalador da última release do GitHub. O nome do arquivo leva a versão
// (Coreto-Setup-0.3.0.exe), então perguntamos à API qual é o da vez, sem precisar
// mexer no site a cada versão nova.

const REPO = 'PedroRagazzo/coreto';
const RELEASES_PAGE = `https://github.com/${REPO}/releases/latest`;
const FRESH_MS = 10 * 60_000;
const RETRY_MS = 60_000;

type Fetch = (url: string, init?: RequestInit) => Promise<Pick<Response, 'ok' | 'json'>>;

interface ReleaseAsset {
  name?: unknown;
  browser_download_url?: unknown;
}

/** Acha o instalador do Windows entre os arquivos da release. */
export function installerUrl(release: unknown): string | null {
  const assets = (release as { assets?: ReleaseAsset[] } | null)?.assets;
  if (!Array.isArray(assets)) return null;
  for (const asset of assets) {
    if (typeof asset.name === 'string' && typeof asset.browser_download_url === 'string' && /^Coreto-Setup-.+\.exe$/.test(asset.name)) {
      return asset.browser_download_url;
    }
  }
  return null;
}

export class LatestInstaller {
  private url: string | null = null;
  private validUntil = 0;
  private pending: Promise<string> | null = null;

  constructor(
    private readonly doFetch: Fetch = (url, init) => fetch(url, init),
    private readonly now: () => number = Date.now,
  ) {}

  /** Link do instalador mais novo; se o GitHub falhar, o último conhecido ou a página de releases. */
  get(): Promise<string> {
    if (this.url && this.now() < this.validUntil) return Promise.resolve(this.url);
    this.pending ??= this.refresh().finally(() => {
      this.pending = null;
    });
    return this.pending;
  }

  private async refresh(): Promise<string> {
    try {
      const res = await this.doFetch(`https://api.github.com/repos/${REPO}/releases/latest`, {
        headers: { accept: 'application/vnd.github+json', 'user-agent': 'coreto-server' },
        signal: AbortSignal.timeout(5_000),
      });
      const found = res.ok ? installerUrl(await res.json()) : null;
      if (found) {
        this.url = found;
        this.validUntil = this.now() + FRESH_MS;
        return found;
      }
    } catch {
      // sem rede ou limite da API: cai no último link conhecido
    }
    this.url ??= RELEASES_PAGE;
    this.validUntil = this.now() + RETRY_MS;
    return this.url;
  }
}
