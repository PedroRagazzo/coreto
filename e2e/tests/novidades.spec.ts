import { expect, test } from '@playwright/test';
import { openPerson } from '../support/app';

const SEEN_KEY = 'coreto.news.seen';

test.describe('janelinha de novidades', () => {
  test('quem já usava o site e não viu a novidade mais nova a recebe uma vez só', async ({ browser }) => {
    const ana = await openPerson(browser, 'Ana');
    // Faz de conta que a Ana abriu o site pela última vez antes de existir qualquer novidade.
    await ana.page.evaluate((key) => localStorage.setItem(key, '2000-01-01'), SEEN_KEY);
    await ana.page.reload();

    const news = ana.page.getByRole('dialog', { name: 'O que há de novo' });
    await expect(news).toBeVisible({ timeout: 10_000 });
    await expect(news.getByRole('listitem').first()).toBeVisible();
    await news.getByRole('button', { name: 'Entendi' }).click();
    await expect(news).toHaveCount(0);

    // Depois de ver, ela não volta, nem recarregando.
    await ana.page.reload();
    await expect(ana.page.getByRole('textbox', { name: 'Mensagem para #geral' })).toBeVisible();
    await ana.page.waitForTimeout(2_500);
    await expect(ana.page.getByRole('dialog', { name: 'O que há de novo' })).toHaveCount(0);
    await ana.context.close();
  });

  test('o histórico fica em Configurações, na seção Novidades', async ({ browser }) => {
    const ana = await openPerson(browser, 'Ana');
    await ana.page.getByRole('button', { name: 'Configurações' }).click();
    await ana.page.getByRole('button', { name: 'Novidades' }).click();
    await expect(ana.page.getByRole('dialog').getByRole('listitem').first()).toBeVisible();
    await ana.context.close();
  });
});
