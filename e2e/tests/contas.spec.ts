import { expect, test } from '@playwright/test';
import { messageRow, openPerson, send, uniqueName } from '../support/app';

test.describe('exclusão de contas', () => {
  test('o administrador geral exclui uma conta; as mensagens dela somem para todos e quem não é administrador não vê o botão', async ({ browser }) => {
    const admin = await openPerson(browser, 'Admin', { name: 'Admin E2E' });
    const bruno = await openPerson(browser, 'Bruno');
    const carla = await openPerson(browser, 'Carla');
    const text = uniqueName('mensagem do Bruno');
    await send(bruno.page, text);
    await expect(messageRow(carla.page, text)).toBeVisible();

    // Quem não é administrador geral não tem o botão de excluir.
    await carla.page.getByRole('list').filter({ hasText: bruno.name }).first().getByText(bruno.name).hover();
    await expect(carla.page.getByRole('button', { name: /^Excluir a conta de / })).toHaveCount(0);

    // O administrador abre o diálogo e só exclui depois de digitar o nome.
    await admin.page.getByRole('list').filter({ hasText: bruno.name }).first().getByText(bruno.name).hover();
    await admin.page.getByRole('button', { name: `Excluir a conta de ${bruno.name}` }).click();
    const dialog = admin.page.getByRole('dialog', { name: 'Excluir conta' });
    const confirm = dialog.getByRole('button', { name: 'Excluir conta' });
    await expect(confirm).toBeDisabled();
    await dialog.getByLabel('Digite o nome da pessoa para confirmar').fill(bruno.name);
    await confirm.click();

    // A mensagem e a pessoa somem para quem ficou, sem recarregar.
    await expect(messageRow(carla.page, text)).toHaveCount(0);
    await expect(messageRow(admin.page, text)).toHaveCount(0);
    await expect(carla.page.getByRole('complementary', { name: 'Membros' }).getByText(bruno.name)).toHaveCount(0);
    await Promise.all([admin, bruno, carla].map((p) => p.context.close()));
  });
});
