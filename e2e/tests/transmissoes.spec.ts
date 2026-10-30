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

test.describe('qualidade para jogos', () => {
  test('a receita "Jogo ou vídeo" escolhe 1080p, 60 fps e Fluidez, e as estatísticas mostram o teto e a travada', async ({ browser }) => {
    const ana = await openPerson(browser, 'Ana');
    const bruno = await openPerson(browser, 'Bruno', { screen: { color: '#1f7a4d', width: 1920, height: 1080 } });
    await joinCall(ana.page);
    await joinCall(bruno.page);

    await bruno.page.getByRole('button', { name: 'Tela', exact: true }).click();
    const dialog = bruno.page.getByRole('dialog', { name: 'Compartilhar tela' });
    // Começa na receita de tela e texto (o padrão).
    await expect(dialog.getByRole('radio', { name: 'Tela e texto' })).toBeChecked();
    await dialog.getByText('Jogo ou vídeo', { exact: true }).click();
    await expect(dialog.getByRole('radio', { name: 'Jogo ou vídeo' })).toBeChecked();
    await expect(dialog.getByRole('radio', { name: '1080p' })).toBeChecked();
    await expect(dialog.getByRole('radio', { name: '60 fps' })).toBeChecked();
    await expect(dialog.getByRole('radio', { name: 'Fluidez' })).toBeChecked();

    // Mexer em um item solta a receita.
    await dialog.getByText('30 fps', { exact: true }).click();
    await expect(dialog.getByRole('radio', { name: 'Jogo ou vídeo' })).not.toBeChecked();
    await dialog.getByText('Jogo ou vídeo', { exact: true }).click();

    await dialog.getByRole('button', { name: 'Escolher tela' }).click();
    await expect(bruno.page.getByRole('region', { name: 'Sua tela' })).toBeVisible();

    await ana.page.getByRole('button', { name: `Assistir à tela de ${bruno.name}` }).click();
    await expect(ana.page.getByRole('region', { name: `Tela de ${bruno.name}` }).locator('video')).toBeVisible();

    // Quem transmite vê o teto pedido ao codificador (1080p a 60 fps, dividido pelo upload de 10 Mbps).
    await bruno.page.getByRole('region', { name: 'Sua tela' }).getByRole('button', { name: 'Estatísticas da transmissão' }).click();
    await expect(bruno.page.getByRole('status', { name: 'Estatísticas da transmissão' })).toContainText(/teto \d/, { timeout: 15_000 });

    // A escolha fica guardada para a próxima transmissão, e a receita continua marcada.
    await bruno.page.getByRole('button', { name: 'Configurações da transmissão' }).first().click();
    await expect(bruno.page.getByRole('dialog').getByRole('radio', { name: 'Jogo ou vídeo' })).toBeChecked();
    await Promise.all([ana, bruno].map((p) => p.context.close()));
  });
});

test.describe('trocar a janela com a transmissão no ar', () => {
  test('quem assiste continua na mesma transmissão, só a imagem muda', async ({ browser }) => {
    const ana = await openPerson(browser, 'Ana');
    // A primeira "janela" é 1280×720; a segunda, 960×540.
    const bruno = await openPerson(browser, 'Bruno', { screen: { width: 1280, height: 720, after: { width: 960, height: 540 } } });
    await joinCall(ana.page);
    await joinCall(bruno.page);
    await startScreen(bruno.page);

    await ana.page.getByRole('button', { name: `Assistir à tela de ${bruno.name}` }).click();
    const video = ana.page.getByRole('region', { name: `Tela de ${bruno.name}` }).locator('video');
    await expect.poll(() => video.evaluate((v: HTMLVideoElement) => v.videoWidth), { timeout: 20_000 }).toBe(1280);

    await bruno.page.getByRole('button', { name: 'Trocar a janela ou tela transmitida' }).first().click();

    // A mesma transmissão passa a mostrar a janela nova, sem aviso de que acabou.
    await expect.poll(() => video.evaluate((v: HTMLVideoElement) => v.videoWidth), { timeout: 20_000 }).toBe(960);
    await expect(ana.page.getByText('A transmissão terminou.')).toHaveCount(0);
    await expect(bruno.page.getByRole('region', { name: 'Sua tela' })).toBeVisible();
    await expect(bruno.page.getByRole('button', { name: 'Parar de transmitir' }).first()).toBeVisible();
    await Promise.all([ana, bruno].map((p) => p.context.close()));
  });
});

test.describe('trocar a janela pelo servidor de mídia', () => {
  // Precisa de um livekit-server local (README, "Testes do site"); no CI não há, e a tela vai pela malha P2P.
  test.skip(!process.env.E2E_LIVEKIT_URL, 'sem E2E_LIVEKIT_URL');

  test('a faixa é trocada na mesma publicação e quem assiste continua recebendo', async ({ browser }) => {
    const ana = await openPerson(browser, 'Ana');
    const bruno = await openPerson(browser, 'Bruno', { screen: { width: 1280, height: 720, after: { width: 960, height: 540 } } });
    await joinCall(ana.page);
    await joinCall(bruno.page);
    await startScreen(bruno.page);
    await ana.page.getByRole('button', { name: `Assistir à tela de ${bruno.name}` }).click();
    const video = ana.page.getByRole('region', { name: `Tela de ${bruno.name}` }).locator('video');
    await expect.poll(() => video.evaluate((v: HTMLVideoElement) => v.videoWidth), { timeout: 30_000 }).toBe(1280);

    // Pelo servidor de mídia: o painel de quem assiste diz isso.
    await ana.page.getByRole('region', { name: `Tela de ${bruno.name}` }).getByRole('button', { name: 'Estatísticas da transmissão' }).click();
    await expect(ana.page.getByRole('status', { name: 'Estatísticas da transmissão' })).toContainText('servidor de mídia', { timeout: 15_000 });

    // Quem transmite vê quanto a rede comporta até o servidor de mídia.
    await bruno.page.getByRole('region', { name: 'Sua tela' }).getByRole('button', { name: 'Estatísticas da transmissão' }).click();
    await expect(bruno.page.getByRole('status', { name: 'Estatísticas da transmissão' })).toContainText(/a rede comporta \d/, { timeout: 15_000 });

    await bruno.page.getByRole('button', { name: 'Trocar a janela ou tela transmitida' }).first().click();
    await expect.poll(() => video.evaluate((v: HTMLVideoElement) => v.videoWidth), { timeout: 30_000 }).toBe(960);
    await expect(ana.page.getByText('A transmissão terminou.')).toHaveCount(0);
    await Promise.all([ana, bruno].map((p) => p.context.close()));
  });
});
