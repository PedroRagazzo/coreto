import { describe, expect, it, vi } from 'vitest';
import { installerUrl, LatestInstaller } from '../../src/download.js';

const release = (version: string) => ({
  assets: [
    { name: `Coreto-Setup-${version}.exe.blockmap`, browser_download_url: `https://x/blockmap-${version}` },
    { name: 'latest.yml', browser_download_url: 'https://x/latest.yml' },
    { name: `Coreto-Setup-${version}.exe`, browser_download_url: `https://x/Coreto-Setup-${version}.exe` },
  ],
});
const ok = (body: unknown) => ({ ok: true, json: async () => body });

describe('installerUrl', () => {
  it('escolhe o .exe e ignora o blockmap e o latest.yml', () => {
    expect(installerUrl(release('0.3.0'))).toBe('https://x/Coreto-Setup-0.3.0.exe');
  });

  it('devolve null quando a release não tem instalador', () => {
    expect(installerUrl({ assets: [] })).toBeNull();
    expect(installerUrl({})).toBeNull();
    expect(installerUrl(null)).toBeNull();
  });
});

describe('LatestInstaller', () => {
  it('guarda o link por um tempo e depois pergunta de novo ao GitHub', async () => {
    let clock = 0;
    const doFetch = vi.fn().mockResolvedValueOnce(ok(release('0.3.0'))).mockResolvedValueOnce(ok(release('0.4.0')));
    const installer = new LatestInstaller(doFetch, () => clock);

    expect(await installer.get()).toBe('https://x/Coreto-Setup-0.3.0.exe');
    clock += 60_000;
    expect(await installer.get()).toBe('https://x/Coreto-Setup-0.3.0.exe');
    expect(doFetch).toHaveBeenCalledTimes(1);

    clock += 11 * 60_000;
    expect(await installer.get()).toBe('https://x/Coreto-Setup-0.4.0.exe');
    expect(doFetch).toHaveBeenCalledTimes(2);
  });

  it('pedidos ao mesmo tempo compartilham uma consulta só', async () => {
    const doFetch = vi.fn().mockResolvedValue(ok(release('0.3.0')));
    const installer = new LatestInstaller(doFetch, () => 0);
    await Promise.all([installer.get(), installer.get(), installer.get()]);
    expect(doFetch).toHaveBeenCalledTimes(1);
  });

  it('se o GitHub falhar, mantém o último link conhecido', async () => {
    let clock = 0;
    const doFetch = vi.fn().mockResolvedValueOnce(ok(release('0.3.0'))).mockRejectedValueOnce(new Error('offline'));
    const installer = new LatestInstaller(doFetch, () => clock);
    await installer.get();
    clock += 11 * 60_000;
    expect(await installer.get()).toBe('https://x/Coreto-Setup-0.3.0.exe');
  });

  it('sem nenhum link conhecido, manda para a página de releases e tenta de novo em 1 minuto', async () => {
    let clock = 0;
    const doFetch = vi.fn().mockResolvedValueOnce({ ok: false, json: async () => ({}) }).mockResolvedValueOnce(ok(release('0.3.0')));
    const installer = new LatestInstaller(doFetch, () => clock);

    expect(await installer.get()).toBe('https://github.com/PedroRagazzo/coreto/releases/latest');
    expect(await installer.get()).toBe('https://github.com/PedroRagazzo/coreto/releases/latest');
    expect(doFetch).toHaveBeenCalledTimes(1);

    clock += 61_000;
    expect(await installer.get()).toBe('https://x/Coreto-Setup-0.3.0.exe');
  });
});
