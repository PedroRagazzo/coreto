import { expect, test } from '@playwright/test';
import { messageRow, openPerson, send, uniqueName } from '../support/app';

test.describe('etiquetas dos membros', () => {
  test('quem administra o espaço dá e tira a etiqueta de alguém, e ela aparece ao lado do nome', async ({ browser }) => {
    const ana = await openPerson(browser, 'Ana');
    const { page } = ana;

    // A pessoa é dona do espaço que cria, então administra ele.
    await page.getByRole('button', { name: 'Criar um espaço' }).click();
    await page.getByLabel('Nome do espaço').fill(uniqueName('Turma'));
    await page.getByRole('button', { name: 'Criar espaço' }).click();
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Turma');
    await page.getByRole('button', { name: 'geral', exact: true }).first().click();
    const text = uniqueName('oi com etiqueta');
    await send(page, text);

    // A aba "Etiquetas" fica nas configurações do espaço.
    await page.getByRole('button', { name: 'Configurações do espaço' }).click();
    const dialog = page.getByRole('dialog', { name: 'Configurações do espaço' });
    await dialog.getByRole('tab', { name: 'Etiquetas' }).click();
    await dialog.getByRole('button', { name: `Editar a etiqueta de ${ana.name}` }).click();
    await dialog.getByRole('textbox', { name: `Etiqueta de ${ana.name}` }).fill('amigo');
    await dialog.getByRole('radio', { name: 'Cor #be185d' }).check();
    await dialog.getByRole('button', { name: 'Salvar' }).click();

    // Na lista de membros e nas mensagens, a etiqueta (em maiúsculas) está ao lado do nome.
    await expect(dialog.getByText('AMIGO')).toBeVisible();
    await dialog.getByRole('button', { name: 'Fechar', exact: true }).click();
    await expect(page.getByRole('complementary', { name: 'Membros' }).getByText('AMIGO')).toBeVisible();
    await expect(messageRow(page, text).getByText('AMIGO')).toBeVisible();

    // Tirar a etiqueta faz ela sumir.
    await page.getByRole('button', { name: 'Configurações do espaço' }).click();
    await dialog.getByRole('tab', { name: 'Etiquetas' }).click();
    await dialog.getByRole('button', { name: `Editar a etiqueta de ${ana.name}` }).click();
    await dialog.getByRole('button', { name: 'Tirar etiqueta' }).click();
    await dialog.getByRole('button', { name: 'Fechar', exact: true }).click();
    await expect(page.getByRole('complementary', { name: 'Membros' }).getByText('AMIGO')).toHaveCount(0);
    await ana.context.close();
  });
});
