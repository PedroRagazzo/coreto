import { expect, test } from '@playwright/test';
import { openPerson, PIN, signIn, uniqueName } from '../support/app';

test.describe('acesso', () => {
  test('a conta é criada no primeiro login e abre o espaço com o canal #geral', async ({ browser }) => {
    const ana = await openPerson(browser, 'Ana');
    await expect(ana.page.getByRole('button', { name: 'Coreto Dev' })).toBeVisible();
    await expect(ana.page.getByText('Boas-vindas a #geral')).toBeVisible();
    // Conta nova não recebe a janelinha de novidades: tudo é novidade para quem chegou agora. Ela só abriria depois de
    // 1,5 s (Changelog.tsx): sem esperar, a checagem passaria mesmo se o site a mostrasse.
    await ana.page.waitForTimeout(2_000);
    await expect(ana.page.getByRole('dialog', { name: 'O que há de novo' })).toHaveCount(0);
    await ana.context.close();
  });

  test('o navegador continua conectado depois de recarregar', async ({ browser }) => {
    const ana = await openPerson(browser, 'Ana');
    await ana.page.reload();
    await expect(ana.page.getByRole('textbox', { name: 'Mensagem para #geral' })).toBeVisible();
    await ana.context.close();
  });

  test('o site conecta por WebSocket e, com o servidor inalcançável, avisa em palavras e volta sozinho', async ({ browser }) => {
    // O socket.io espera até 20 s antes de desistir de uma tentativa de conexão; o aviso só aparece depois disso.
    test.setTimeout(120_000);
    const context = await browser.newContext();
    const page = await context.newPage();
    let pollingBlocked = true;
    const sockets: string[] = [];
    page.on('websocket', (ws) => sockets.push(ws.url()));
    await signIn(page, uniqueName('Ana'));
    // WebSocket primeiro: não depende de várias requisições HTTP seguidas, que falhavam com "xhr poll error" atrás de proxy/VPN.
    expect(sockets.some((url) => url.includes('/socket.io/'))).toBe(true);

    // Um proxy que derruba tanto o WebSocket quanto o polling: o site não alcança o servidor em tempo real.
    await page.addInitScript(() => {
      const Original = window.WebSocket;
      window.WebSocket = new Proxy(Original, {
        construct(target, args: ConstructorParameters<typeof WebSocket>) {
          if (localStorage.getItem('bloquear-websocket')) throw new DOMException('bloqueado pelo teste', 'SecurityError');
          return new target(...args);
        },
      });
    });
    await page.evaluate(() => localStorage.setItem('bloquear-websocket', '1'));
    await page.route('**/socket.io/**', (route) => (pollingBlocked ? route.abort() : route.continue()));
    await page.reload();
    const banner = page.getByRole('status').filter({ hasText: 'Sem conexão' });
    await expect(banner).toContainText('Não deu para alcançar o servidor', { timeout: 45_000 });
    await expect(banner).not.toContainText('xhr poll error');

    pollingBlocked = false;
    await page.evaluate(() => localStorage.removeItem('bloquear-websocket'));
    await expect(banner).toHaveCount(0, { timeout: 45_000 });
    await expect(page.getByRole('textbox', { name: 'Mensagem para #geral' })).toBeVisible();
    await context.close();
  });

  test('PIN errado numa conta que já existe é recusado, e o certo entra', async ({ browser }) => {
    const ana = await openPerson(browser, 'Ana');
    const other = await browser.newContext();
    const page = await other.newPage();
    await page.goto('/');
    await page.getByPlaceholder('Seu nome').fill(ana.name);
    await page.getByPlaceholder('••••').fill('0000');
    await page.getByRole('button', { name: 'Entrar', exact: true }).click();
    await expect(page.getByRole('alert')).toHaveText('PIN incorreto para esse nome.');

    await signIn(page, ana.name, PIN);
    await expect(page.getByRole('textbox', { name: 'Mensagem para #geral' })).toBeVisible();
    await other.close();
    await ana.context.close();
  });

  test('o botão Entrar só habilita com nome e um PIN de 4 números', async ({ page }) => {
    await page.goto('/');
    const enter = page.getByRole('button', { name: 'Entrar', exact: true });
    await expect(enter).toBeDisabled();
    await page.getByPlaceholder('Seu nome').fill(uniqueName('Zé'));
    await page.getByPlaceholder('••••').fill('12a3b');
    await expect(page.getByPlaceholder('••••')).toHaveValue('123'); // só números
    await expect(enter).toBeDisabled();
    await page.getByPlaceholder('••••').fill('1234');
    await expect(enter).toBeEnabled();
  });
});
