import { expect, test } from '@playwright/test';
import { hoverMessage, messageRow, openPerson, send, uniqueName } from '../support/app';

test.describe('reações e mensagens fixadas', () => {
  test('uma reação aparece para os outros e some quando a pessoa a tira', async ({ browser }) => {
    const ana = await openPerson(browser, 'Ana');
    const bruno = await openPerson(browser, 'Bruno');
    const text = uniqueName('quem curte pizza');
    await send(ana.page, text);
    await expect(messageRow(bruno.page, text)).toBeVisible();

    const row = await hoverMessage(bruno.page, text);
    await row.getByRole('button', { name: 'Reagir', exact: true }).click();
    await bruno.page.getByRole('button', { name: /^Reagir com / }).first().click();

    const chip = (page: typeof ana.page) => messageRow(page, text).getByRole('group', { name: 'Reações' }).getByRole('button').first();
    await expect(chip(ana.page)).toContainText('1');
    await expect(chip(bruno.page)).toContainText('1');

    // Clicar de novo na própria reação a tira.
    await chip(bruno.page).click();
    await expect(messageRow(ana.page, text).getByRole('group', { name: 'Reações' })).toHaveCount(0);
    await Promise.all([ana, bruno].map((p) => p.context.close()));
  });

  test('fixar uma mensagem a põe na lista de fixadas de todo mundo', async ({ browser }) => {
    const ana = await openPerson(browser, 'Ana');
    const bruno = await openPerson(browser, 'Bruno');
    const text = uniqueName('regras da casa');
    await send(ana.page, text);
    await expect(messageRow(bruno.page, text)).toBeVisible();

    const row = await hoverMessage(ana.page, text);
    await row.getByRole('button', { name: 'Fixar mensagem' }).click();
    await expect(messageRow(bruno.page, text)).toContainText('Fixada');

    await bruno.page.getByRole('button', { name: 'Mensagens fixadas' }).click();
    await expect(bruno.page.getByRole('complementary', { name: 'Mensagens fixadas' })).toContainText(text);

    // Desafixar tira da lista.
    await (await hoverMessage(ana.page, text)).getByRole('button', { name: 'Desafixar mensagem' }).click();
    await expect(bruno.page.getByRole('complementary', { name: 'Mensagens fixadas' })).not.toContainText(text);
    await Promise.all([ana, bruno].map((p) => p.context.close()));
  });

  test('quem escreve edita a própria mensagem e todo mundo vê o novo texto', async ({ browser }) => {
    const ana = await openPerson(browser, 'Ana');
    const bruno = await openPerson(browser, 'Bruno');
    const before = uniqueName('texto com erro');
    await send(ana.page, before);
    await expect(messageRow(bruno.page, before)).toBeVisible();

    const row = await hoverMessage(ana.page, before);
    await row.getByRole('button', { name: 'Editar mensagem' }).click();
    const after = uniqueName('texto corrigido');
    // Em edição o texto vira um campo: a linha deixa de casar pelo texto, então o campo se acha pela página.
    const editor = ana.page.getByRole('textbox', { name: 'Editar mensagem' });
    await editor.fill(after);
    await editor.press('Enter');

    await expect(messageRow(bruno.page, after)).toBeVisible();
    await expect(bruno.page.getByText(before)).toHaveCount(0);
    await Promise.all([ana, bruno].map((p) => p.context.close()));
  });

  test('apagar a própria mensagem a tira da conversa de todos', async ({ browser }) => {
    const ana = await openPerson(browser, 'Ana');
    const bruno = await openPerson(browser, 'Bruno');
    const text = uniqueName('vou apagar isto');
    await send(ana.page, text);
    await expect(messageRow(bruno.page, text)).toBeVisible();

    const row = await hoverMessage(ana.page, text);
    await row.getByRole('button', { name: 'Apagar mensagem' }).click();
    // Confirma no diálogo de exclusão.
    await ana.page.getByRole('dialog').getByRole('button', { name: /^Apagar/ }).click();
    await expect(bruno.page.getByText(text)).toHaveCount(0);
    await Promise.all([ana, bruno].map((p) => p.context.close()));
  });
});
