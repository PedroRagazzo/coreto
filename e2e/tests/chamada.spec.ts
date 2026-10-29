import { expect, test } from '@playwright/test';
import { audioBytesReceived, joinCall, openPerson } from '../support/app';

test.describe('chamada de voz', () => {
  test('duas pessoas entram na sala, se veem na lista e a voz de uma chega na outra', async ({ browser }) => {
    const ana = await openPerson(browser, 'Ana');
    const bruno = await openPerson(browser, 'Bruno');
    await joinCall(ana.page);
    await joinCall(bruno.page);

    // As duas aparecem na sala, para as duas.
    for (const page of [ana.page, bruno.page]) {
      const room = page.getByRole('list', { name: 'Na sala Sala de estar' });
      await expect(room).toContainText(ana.name);
      await expect(room).toContainText(bruno.name);
    }

    // A voz (o tom do microfone falso) chega de verdade, nos dois sentidos.
    await expect.poll(() => audioBytesReceived(ana.page), { timeout: 20_000 }).toBeGreaterThan(2_000);
    await expect.poll(() => audioBytesReceived(bruno.page), { timeout: 20_000 }).toBeGreaterThan(2_000);
    await Promise.all([ana, bruno].map((p) => p.context.close()));
  });

  test('mutar mostra o ícone para os outros, e sair da chamada tira a pessoa da sala', async ({ browser }) => {
    const ana = await openPerson(browser, 'Ana');
    const bruno = await openPerson(browser, 'Bruno');
    await joinCall(ana.page);
    await joinCall(bruno.page);

    await bruno.page.getByRole('button', { name: 'Desativar microfone' }).first().click();
    await expect(bruno.page.getByRole('button', { name: 'Ativar microfone' }).first()).toBeVisible();
    // Na visão da chamada da Ana, o quadro do Bruno ganha o ícone de microfone desativado (a barra lateral tem outro igual).
    const muted = ana.page.getByRole('list', { name: 'Pessoas na chamada' }).getByLabel('Microfone desativado');
    await expect(muted).toBeVisible();

    await bruno.page.getByRole('button', { name: 'Ativar microfone' }).first().click();
    await expect(muted).toHaveCount(0);

    await bruno.page.getByRole('button', { name: 'Sair da chamada' }).first().click();
    await expect(bruno.page.getByText('Voz conectada')).toHaveCount(0);
    await expect(ana.page.getByRole('list', { name: 'Na sala Sala de estar' })).not.toContainText(bruno.name);
    await Promise.all([ana, bruno].map((p) => p.context.close()));
  });

  test('o indicador de conexão aparece ao lado de cada pessoa depois de alguns segundos', async ({ browser }) => {
    const ana = await openPerson(browser, 'Ana');
    const bruno = await openPerson(browser, 'Bruno');
    await joinCall(ana.page);
    await joinCall(bruno.page);
    // Medido a cada 2 s sobre uma janela de ~8 s: no máximo em ~12 s já deve haver uma leitura.
    await expect(ana.page.getByRole('list', { name: 'Pessoas na chamada' }).getByRole('img', { name: /conexão/i }).first()).toBeVisible({ timeout: 25_000 });
    await Promise.all([ana, bruno].map((p) => p.context.close()));
  });

  test('numa janela em pé o mosaico da chamada usa uma coluna, e numa larga lado a lado', async ({ browser }) => {
    const ana = await openPerson(browser, 'Ana', { viewport: { width: 1080, height: 1920 } });
    const bruno = await openPerson(browser, 'Bruno');
    await joinCall(ana.page);
    await joinCall(bruno.page);

    const list = ana.page.getByRole('list', { name: 'Pessoas na chamada' });
    await expect(list.getByRole('listitem')).toHaveCount(2);
    const columns = () => list.evaluate((el) => getComputedStyle(el).gridTemplateColumns.split(' ').length);
    await expect.poll(columns).toBe(1);

    await ana.page.setViewportSize({ width: 1800, height: 700 });
    await expect.poll(columns).toBe(2);
    await Promise.all([ana, bruno].map((p) => p.context.close()));
  });
});
