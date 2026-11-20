import { expect, test } from '@playwright/test';
import { openPerson } from '../support/app';

const PHONE = { width: 390, height: 844 };

test.describe('celular', () => {
  test('abre na conversa; Voltar à lista mostra espaços e canais; tocar num canal volta à conversa', async ({ browser }) => {
    const ana = await openPerson(browser, 'Ana', { viewport: PHONE });
    const { page } = ana;
    const box = page.getByRole('textbox', { name: 'Mensagem para #geral' });
    await expect(box).toBeVisible();

    await page.getByRole('button', { name: 'Voltar à lista' }).click();
    await expect(page.getByRole('navigation', { name: 'Espaços' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'geral', exact: true }).first()).toBeVisible();
    await expect(box).toBeHidden();

    await page.getByRole('button', { name: 'geral', exact: true }).first().click();
    await expect(box).toBeVisible();
    await ana.context.close();
  });

  test('o botão voltar do aparelho na conversa leva à lista, sem sair do Coreto', async ({ browser }) => {
    const ana = await openPerson(browser, 'Ana', { viewport: PHONE });
    const { page } = ana;
    await page.getByRole('button', { name: 'Voltar à lista' }).click();
    await page.getByRole('button', { name: 'geral', exact: true }).first().click();
    await expect(page.getByRole('textbox', { name: 'Mensagem para #geral' })).toBeVisible();

    await page.goBack();
    await expect(page.getByRole('navigation', { name: 'Espaços' })).toBeVisible();
    await expect(page.getByRole('textbox', { name: 'Mensagem para #geral' })).toBeHidden();
    await ana.context.close();
  });

  test('no computador o botão Voltar à lista não aparece e as três colunas ficam juntas', async ({ browser }) => {
    const ana = await openPerson(browser, 'Ana');
    const { page } = ana;
    await expect(page.getByRole('button', { name: 'Voltar à lista' })).toBeHidden();
    await expect(page.getByRole('navigation', { name: 'Espaços' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'geral', exact: true }).first()).toBeVisible();
    await expect(page.getByRole('textbox', { name: 'Mensagem para #geral' })).toBeVisible();
    await ana.context.close();
  });
});
