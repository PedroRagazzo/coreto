import { expect, test } from '@playwright/test';
import { messageRow, openPerson, uniqueName } from '../support/app';

test.describe('enquetes e roleta', () => {
  test('uma enquete aparece para todos, cada voto conta uma vez e o autor a encerra', async ({ browser }) => {
    const ana = await openPerson(browser, 'Ana');
    const bruno = await openPerson(browser, 'Bruno');
    const question = uniqueName('Que jogo hoje');

    await ana.page.getByRole('button', { name: 'Criar enquete ou roleta' }).click();
    await ana.page.getByRole('menuitem', { name: /Enquete/ }).click();
    const dialog = ana.page.getByRole('dialog', { name: 'Criar enquete' });
    await dialog.getByLabel('Pergunta').fill(question);
    await dialog.getByLabel('Opção 1').fill('Minecraft');
    await dialog.getByLabel('Opção 2').fill('Valorant');
    await dialog.getByRole('button', { name: 'Criar enquete' }).click();

    await expect(messageRow(ana.page, question)).toContainText('Ninguém votou ainda');
    const poll = messageRow(bruno.page, question);
    await expect(poll).toContainText('Minecraft');

    await poll.getByRole('button', { name: /Minecraft/ }).click();
    await expect(poll.getByRole('button', { name: /Minecraft/ })).toContainText('1 · 100%');
    // Quem criou vê o voto na hora.
    await expect(messageRow(ana.page, question)).toContainText('1 pessoa votou');

    // Votar de novo na mesma opção tira o voto (enquete de uma resposta só).
    await poll.getByRole('button', { name: /Minecraft/ }).click();
    await expect(messageRow(ana.page, question)).toContainText('Ninguém votou ainda');

    await poll.getByRole('button', { name: /Valorant/ }).click();
    await expect(messageRow(ana.page, question)).toContainText('1 pessoa votou');

    await messageRow(ana.page, question).getByRole('button', { name: 'Encerrar enquete' }).click();
    await expect(messageRow(bruno.page, question)).toContainText('Encerrada');
    await expect(messageRow(bruno.page, question).getByRole('button', { name: /Valorant/ })).toBeDisabled();
    await Promise.all([ana, bruno].map((p) => p.context.close()));
  });

  test('a enquete pede pelo menos duas opções preenchidas', async ({ browser }) => {
    const ana = await openPerson(browser, 'Ana');
    await ana.page.getByRole('button', { name: 'Criar enquete ou roleta' }).click();
    await ana.page.getByRole('menuitem', { name: /Enquete/ }).click();
    const dialog = ana.page.getByRole('dialog', { name: 'Criar enquete' });
    await dialog.getByLabel('Pergunta').fill('Só uma opção?');
    await dialog.getByLabel('Opção 1').fill('Sim');
    await expect(dialog.getByRole('button', { name: 'Criar enquete' })).toBeDisabled();
    await dialog.getByLabel('Opção 2').fill('Não');
    await expect(dialog.getByRole('button', { name: 'Criar enquete' })).toBeEnabled();
    await ana.context.close();
  });

  test('a roleta sorteia uma opção só, a mesma para todo mundo, e gira uma vez', async ({ browser }) => {
    const ana = await openPerson(browser, 'Ana');
    const bruno = await openPerson(browser, 'Bruno');
    const title = uniqueName('Que jogo');

    await ana.page.getByRole('button', { name: 'Criar enquete ou roleta' }).click();
    await ana.page.getByRole('menuitem', { name: /Roleta/ }).click();
    const dialog = ana.page.getByRole('dialog', { name: /roleta/i });
    await dialog.getByLabel('Título').fill(title);
    await dialog.getByLabel(/Opções/).fill('Minecraft\nValorant\nAmong Us');
    await dialog.getByRole('button', { name: 'Criar roleta' }).click();

    const forBruno = messageRow(bruno.page, title);
    await expect(forBruno.getByRole('img', { name: 'Roleta com 3 opções' })).toBeVisible();
    await forBruno.getByRole('button', { name: 'Girar' }).click();

    // A animação leva alguns segundos; o resultado é igual para os dois e é uma das opções.
    const winner = async (page: typeof ana.page) => {
      const row = messageRow(page, title);
      await expect(row).toContainText(`Girada por ${bruno.name}`, { timeout: 20_000 });
      return row.locator('[aria-live=polite] span').first().innerText();
    };
    const [seenByBruno, seenByAna] = [await winner(bruno.page), await winner(ana.page)];
    expect(['Minecraft', 'Valorant', 'Among Us']).toContain(seenByBruno);
    expect(seenByAna).toBe(seenByBruno);
    // Já foi girada: ninguém gira de novo.
    await expect(messageRow(ana.page, title).getByRole('button', { name: 'Girar' })).toHaveCount(0);
    await Promise.all([ana, bruno].map((p) => p.context.close()));
  });
});
