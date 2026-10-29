import { expect, test } from '@playwright/test';
import { openPerson, PIN, signIn, uniqueName } from '../support/app';

test.describe('acesso', () => {
  test('a conta é criada no primeiro login e abre o espaço com o canal #geral', async ({ browser }) => {
    const ana = await openPerson(browser, 'Ana');
    await expect(ana.page.getByRole('button', { name: 'Coreto Dev' })).toBeVisible();
    await expect(ana.page.getByText('Boas-vindas a #geral')).toBeVisible();
    // Conta nova não recebe a janelinha de novidades: tudo é novidade para quem chegou agora.
    await expect(ana.page.getByRole('dialog', { name: 'O que há de novo' })).toHaveCount(0);
    await ana.context.close();
  });

  test('o navegador continua conectado depois de recarregar', async ({ browser }) => {
    const ana = await openPerson(browser, 'Ana');
    await ana.page.reload();
    await expect(ana.page.getByRole('textbox', { name: 'Mensagem para #geral' })).toBeVisible();
    await ana.context.close();
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
