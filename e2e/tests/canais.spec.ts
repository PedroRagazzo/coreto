import { expect, test } from '@playwright/test';
import { openPerson, uniqueName } from '../support/app';

test.describe('canais', () => {
  test('quem gerencia liga "guardar os arquivos para sempre" num canal e o aviso do anexo muda', async ({ browser }) => {
    const ana = await openPerson(browser, 'Ana');
    const { page } = ana;

    // A pessoa é dona do espaço que cria, então pode editar os canais dele.
    await page.getByRole('button', { name: 'Criar um espaço' }).click();
    await page.getByLabel('Nome do espaço').fill(uniqueName('Museu'));
    await page.getByRole('button', { name: 'Criar espaço' }).click();
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Museu');

    // Num canal comum, o anexo avisa que some depois de 20 dias.
    await page.getByRole('button', { name: 'geral', exact: true }).first().click();
    await expect(page.getByTitle(/Anexar arquivo \(fica 20 dias no servidor\)/)).toBeVisible();

    await page.getByRole('button', { name: 'Editar #geral' }).click();
    const dialog = page.getByRole('dialog', { name: 'Editar canal' });
    const keep = dialog.getByRole('checkbox', { name: /Guardar os arquivos e fotos para sempre/ });
    await expect(keep).not.toBeChecked();
    await keep.check();
    await dialog.getByRole('button', { name: 'Salvar' }).click();
    await expect(dialog).toBeHidden();

    // Agora o canal guarda tudo, e o aviso do anexo diz isso.
    await expect(page.getByTitle(/Anexar arquivo \(este canal guarda os arquivos para sempre\)/)).toBeVisible();

    // A escolha ficou: ao reabrir, a opção está ligada; desligar volta ao prazo normal.
    await page.getByRole('button', { name: 'Editar #geral' }).click();
    const again = page.getByRole('dialog', { name: 'Editar canal' });
    const keepAgain = again.getByRole('checkbox', { name: /Guardar os arquivos e fotos para sempre/ });
    await expect(keepAgain).toBeChecked();
    await keepAgain.uncheck();
    await expect(again).toContainText('Ao desligar, os anexos com mais de 20 dias');
    await again.getByRole('button', { name: 'Salvar' }).click();
    await expect(page.getByTitle(/Anexar arquivo \(fica 20 dias no servidor\)/)).toBeVisible();
    await ana.context.close();
  });
});
