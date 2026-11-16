import { expect, test } from '@playwright/test';
import { joinCall, openPerson } from '../support/app';

test.describe('música', () => {
  test('repetir, ir a um ponto da música e votar para pular, pelo painel', async ({ browser }) => {
    const ana = await openPerson(browser, 'Ana');
    const bruno = await openPerson(browser, 'Bruno');
    const carla = await openPerson(browser, 'Carla');
    await Promise.all([ana, bruno, carla].map((p) => joinCall(p.page)));

    await ana.page.getByRole('button', { name: 'Música', exact: true }).first().click();
    const dialog = ana.page.getByRole('dialog', { name: 'Música' });
    await dialog.getByRole('textbox', { name: 'Música para tocar' }).fill('luar');
    await dialog.getByRole('button', { name: 'Adicionar' }).click();
    await expect(dialog.getByText('luar').first()).toBeVisible();

    // Repetir: o botão passa de desligado para "da música" e depois "da fila", e volta ao desligado; deixa "da música",
    // que mantém a música de teste (4 s) tocando em laço durante o resto do teste.
    const repeat = dialog.getByRole('button', { name: /^Repetição/ });
    await expect(repeat).toHaveAccessibleName('Repetição desligada');
    await repeat.click();
    await expect(repeat).toHaveAccessibleName('Repetição da música');
    await expect(repeat).toHaveAttribute('aria-pressed', 'true');
    await repeat.click();
    await expect(repeat).toHaveAccessibleName('Repetição da fila');
    await repeat.click();
    await expect(repeat).toHaveAccessibleName('Repetição desligada');
    await repeat.click();
    await expect(repeat).toHaveAccessibleName('Repetição da música');

    // Com três pessoas na sala, pular é uma votação (a metade mais um = 2 votos), e a música continua até lá.
    await bruno.page.getByRole('button', { name: 'Música', exact: true }).first().click();
    const brunoDialog = bruno.page.getByRole('dialog', { name: 'Música' });
    await brunoDialog.getByRole('button', { name: 'Votar para pular (0/2 votos)' }).click();
    await expect(dialog.getByRole('button', { name: 'Votar para pular (1/2 votos)' })).toBeVisible();
    await expect(dialog.getByText('luar').first()).toBeVisible();

    // Ir a um ponto: o botão de avançar anda até perto do fim da música de teste.
    await dialog.getByRole('button', { name: 'Avançar 10 segundos' }).click();
    await expect(dialog.getByRole('slider', { name: 'Posição da música' })).toHaveAttribute('aria-valuetext', /^0:0[23] de 0:04$/);

    // Quem pediu a música pula direto: a sala fica sem música.
    await dialog.getByRole('button', { name: /^Votar para pular/ }).click();
    await expect(dialog.getByText('Nada tocando')).toBeVisible();

    await dialog.getByRole('button', { name: 'Fechar' }).click();
    await Promise.all([ana, bruno, carla].map((p) => p.context.close()));
  });
});
