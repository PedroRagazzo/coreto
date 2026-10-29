import { expect, test, type Page } from '@playwright/test';
import { joinCall, openPerson, startScreen } from '../support/app';

/** O arranjo que o palco escolheu agora: quantas colunas a grade tem e se está empilhado (janela em pé). */
const stageLayout = (page: Page) =>
  page.locator('[data-layout]').evaluate((el) => ({
    columns: getComputedStyle(el).gridTemplateColumns.split(' ').length,
    stacked: (el as HTMLElement).dataset.stacked === 'true',
  }));

test.describe('transmissões de tela', () => {
  test('quem assiste recebe a imagem da tela de quem transmite', async ({ browser }) => {
    const ana = await openPerson(browser, 'Ana', { screen: { color: '#7a2d9e', width: 1280, height: 720 } });
    const bruno = await openPerson(browser, 'Bruno', { screen: { color: '#1f7a4d', width: 1280, height: 720 } });
    await joinCall(ana.page);
    await joinCall(bruno.page);
    await startScreen(bruno.page);

    // A Ana vê o "AO VIVO" do Bruno na sala e escolhe assistir.
    await ana.page.getByRole('button', { name: `Assistir à tela de ${bruno.name}` }).click();
    const video = ana.page.getByRole('region', { name: `Tela de ${bruno.name}` }).locator('video');
    await expect(video).toBeVisible();
    await expect.poll(() => video.evaluate((v: HTMLVideoElement) => v.videoWidth), { timeout: 20_000 }).toBe(1280);

    // O Bruno vê quantas pessoas assistem.
    await expect(bruno.page.getByRole('region', { name: 'Sua tela' })).toContainText('1');
    await Promise.all([ana, bruno].map((p) => p.context.close()));
  });

  test('parar de transmitir avisa quem assistia', async ({ browser }) => {
    const ana = await openPerson(browser, 'Ana');
    const bruno = await openPerson(browser, 'Bruno', { screen: {} });
    await joinCall(ana.page);
    await joinCall(bruno.page);
    await startScreen(bruno.page);
    await ana.page.getByRole('button', { name: `Assistir à tela de ${bruno.name}` }).click();
    await expect(ana.page.getByRole('region', { name: `Tela de ${bruno.name}` })).toBeVisible();

    await bruno.page.getByRole('button', { name: 'Parar de transmitir' }).first().click();
    await expect(ana.page.getByText('A transmissão terminou.')).toBeVisible();
    await Promise.all([ana, bruno].map((p) => p.context.close()));
  });

  test('numa janela em pé as transmissões empilham, e numa larga ficam lado a lado', async ({ browser }) => {
    // A pessoa do monitor em pé (1080×1920) assiste a uma transmissão e também transmite: duas telas no palco.
    const ana = await openPerson(browser, 'Ana', { viewport: { width: 1080, height: 1920 }, screen: { color: '#7a2d9e' } });
    const bruno = await openPerson(browser, 'Bruno', { screen: { color: '#1f7a4d' } });
    await joinCall(ana.page);
    await joinCall(bruno.page);
    await startScreen(ana.page);
    await startScreen(bruno.page);
    await ana.page.getByRole('button', { name: `Assistir à tela de ${bruno.name}` }).click();
    await expect(ana.page.getByRole('heading', { name: 'Transmissões abertas (2)' })).toBeVisible();

    // Uma em destaque: a grande em cima e a pequena numa fileira embaixo, em vez de uma coluna estreita ao lado.
    await expect.poll(() => stageLayout(ana.page)).toMatchObject({ stacked: true, columns: 1 });
    const mainTile = await ana.page.getByRole('region', { name: `Tela de ${bruno.name}` }).boundingBox();
    expect(mainTile!.width).toBeGreaterThan(600);

    // Todas do mesmo tamanho: cada uma na largura toda do palco (uma coluna), uma sobre a outra.
    await ana.page.getByRole('button', { name: 'Todas do mesmo tamanho' }).click();
    await expect.poll(() => stageLayout(ana.page)).toMatchObject({ columns: 1 });
    const [first, second] = await Promise.all([
      ana.page.getByRole('region', { name: 'Sua tela' }).boundingBox(),
      ana.page.getByRole('region', { name: `Tela de ${bruno.name}` }).boundingBox(),
    ]);
    expect(first!.width).toBeGreaterThan(600);
    expect(Math.abs(first!.width - second!.width)).toBeLessThan(2);
    expect(second!.y).toBeGreaterThan(first!.y + first!.height - 2);

    // A mesma pessoa numa janela larga: lado a lado.
    await ana.page.setViewportSize({ width: 1800, height: 700 });
    await expect.poll(() => stageLayout(ana.page)).toMatchObject({ columns: 2, stacked: false });
    await Promise.all([ana, bruno].map((p) => p.context.close()));
  });
});
