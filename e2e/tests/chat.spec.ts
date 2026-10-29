import { expect, test } from '@playwright/test';
import { hoverMessage, messageRow, openPerson, send, uniqueName } from '../support/app';

test.describe('conversa', () => {
  test('uma mensagem chega para os outros na hora, e quem entra depois a vê no histórico', async ({ browser }) => {
    const ana = await openPerson(browser, 'Ana');
    const bruno = await openPerson(browser, 'Bruno');
    const text = uniqueName('olá pessoal');

    await send(ana.page, text);
    await expect(messageRow(ana.page, text)).toBeVisible();
    await expect(messageRow(bruno.page, text)).toBeVisible();

    const carla = await openPerson(browser, 'Carla');
    await expect(messageRow(carla.page, text)).toBeVisible();
    await Promise.all([ana, bruno, carla].map((p) => p.context.close()));
  });

  test('responder cita a mensagem original', async ({ browser }) => {
    const ana = await openPerson(browser, 'Ana');
    const bruno = await openPerson(browser, 'Bruno');
    const original = uniqueName('quem traz o bolo');
    await send(ana.page, original);
    await expect(messageRow(bruno.page, original)).toBeVisible();

    const row = await hoverMessage(bruno.page, original);
    await row.getByRole('button', { name: 'Responder' }).click();
    const answer = uniqueName('eu trago');
    await send(bruno.page, answer);

    // A resposta aparece na conversa de quem escreveu a original, com a citação.
    await expect(messageRow(ana.page, answer)).toContainText(original);
    await expect(messageRow(ana.page, answer).getByTitle('Ir para a mensagem respondida')).toBeVisible();
    await Promise.all([ana, bruno].map((p) => p.context.close()));
  });

  test('a mensagem de um canal não aparece em outro', async ({ browser }) => {
    const ana = await openPerson(browser, 'Ana');
    const bruno = await openPerson(browser, 'Bruno');
    const text = uniqueName('só na ajuda');
    await ana.page.getByRole('button', { name: /ajuda/ }).first().click();
    await send(ana.page, text);
    await expect(messageRow(ana.page, text)).toBeVisible();
    // Bruno está no #geral: não vê a mensagem da ajuda.
    await expect(messageRow(bruno.page, text)).toHaveCount(0);
    await Promise.all([ana, bruno].map((p) => p.context.close()));
  });
});
