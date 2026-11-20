import { expect, test, type Page } from '@playwright/test';
import { joinCall, openPerson, send, startScreen, uniqueName } from '../support/app';

const PHONE = { width: 390, height: 844 };

/** Troca o pedido de "manter a tela ligada" por um contador, e anota o que a página pediu ao controle de mídia do sistema. */
async function spyOnSystem(page: Page) {
  await page.evaluate(() => {
    const w = window as unknown as { __locks: number; __handlers: Record<string, unknown> };
    w.__locks = 0;
    w.__handlers = {};
    Object.defineProperty(navigator, 'wakeLock', {
      configurable: true,
      value: {
        request: async () => {
          w.__locks++;
          const lock = {
            released: false,
            release: async () => {
              if (!lock.released) w.__locks--;
              lock.released = true;
            },
          };
          return lock;
        },
      },
    });
    const original = navigator.mediaSession.setActionHandler.bind(navigator.mediaSession);
    navigator.mediaSession.setActionHandler = (action, handler) => {
      w.__handlers[action] = handler;
      original(action, handler);
    };
  });
}
const locks = (page: Page) => page.evaluate(() => (window as unknown as { __locks: number }).__locks);

test.describe('celular', () => {
  test('abre na conversa; Voltar à lista mostra espaços e canais; tocar num canal volta à conversa', async ({ browser }) => {
    const ana = await openPerson(browser, 'Ana', { viewport: PHONE });
    const { page } = ana;
    const box = page.getByRole('textbox', { name: 'Mensagem para #geral' });
    await expect(box).toBeVisible();

    await page.getByRole('button', { name: 'Voltar à lista' }).click();
    await expect(page.getByRole('navigation', { name: 'Espaços' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'geral', exact: true }).first()).toBeVisible();
    await expect(box).toBeHidden();

    await page.getByRole('button', { name: 'geral', exact: true }).first().click();
    await expect(box).toBeVisible();
    await ana.context.close();
  });

  test('o botão voltar do aparelho na conversa leva à lista, sem sair do Coreto', async ({ browser }) => {
    const ana = await openPerson(browser, 'Ana', { viewport: PHONE });
    const { page } = ana;
    await page.getByRole('button', { name: 'Voltar à lista' }).click();
    await page.getByRole('button', { name: 'geral', exact: true }).first().click();
    await expect(page.getByRole('textbox', { name: 'Mensagem para #geral' })).toBeVisible();

    await page.goBack();
    await expect(page.getByRole('navigation', { name: 'Espaços' })).toBeVisible();
    await expect(page.getByRole('textbox', { name: 'Mensagem para #geral' })).toBeHidden();
    await ana.context.close();
  });

  test('entrar numa chamada pela lista abre a visão da chamada; com a conversa aberta, uma barra deixa mutar e sair', async ({ browser }) => {
    const ana = await openPerson(browser, 'Ana', { viewport: PHONE });
    const { page } = ana;
    await page.getByRole('button', { name: 'Voltar à lista' }).click();
    await page.getByRole('button', { name: 'Sala de estar', exact: true }).click();
    await expect(page.getByRole('heading', { level: 2, name: 'Sala de estar' })).toBeVisible();

    await page.getByRole('button', { name: 'Fechar a visão da chamada' }).click();
    await expect(page.getByRole('textbox', { name: 'Mensagem para #geral' })).toBeVisible();
    const bar = page.getByRole('region', { name: 'Chamada em andamento' });
    await expect(bar).toContainText('Sala de estar');
    await bar.getByRole('button', { name: 'Desativar microfone' }).click();
    await expect(bar.getByRole('button', { name: 'Ativar microfone' })).toBeVisible();

    await bar.getByRole('button', { name: 'Sair da chamada' }).click();
    await expect(bar).toHaveCount(0);
    await ana.context.close();
  });

  test('tocar na transmissão de alguém na lista abre o palco com o botão de voltar', async ({ browser }) => {
    const ana = await openPerson(browser, 'Ana', { viewport: PHONE });
    const bruno = await openPerson(browser, 'Bruno', { screen: { color: '#1f7a4d', width: 1280, height: 720 } });
    await joinCall(bruno.page);
    await startScreen(bruno.page);

    await ana.page.getByRole('button', { name: 'Voltar à lista' }).click();
    await ana.page.getByRole('button', { name: `Assistir à tela de ${bruno.name}` }).click();
    await expect(ana.page.getByRole('region', { name: `Tela de ${bruno.name}` })).toBeVisible();
    await ana.page.getByRole('button', { name: 'Voltar à lista' }).first().click();
    await expect(ana.page.getByRole('navigation', { name: 'Espaços' })).toBeVisible();
    await Promise.all([ana, bruno].map((p) => p.context.close()));
  });

  test('no celular, membros, busca e fixadas ocupam a tela inteira e Fechar volta à conversa', async ({ browser }) => {
    const ana = await openPerson(browser, 'Ana', { viewport: PHONE });
    const { page } = ana;
    const box = page.getByRole('textbox', { name: 'Mensagem para #geral' });
    await expect(page.getByRole('button', { name: 'Buscar mensagens' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Mensagens fixadas' })).toBeVisible();
    await expect(page.getByRole('complementary', { name: 'Membros' })).toBeHidden();

    await page.getByRole('button', { name: 'Mostrar membros' }).click();
    await expect(page.getByRole('complementary', { name: 'Membros' })).toBeVisible();
    await expect(box).toBeHidden();
    await page.getByRole('button', { name: 'Fechar membros' }).click();
    await expect(box).toBeVisible();

    const text = uniqueName('procurada');
    await send(page, text);
    await page.getByRole('button', { name: 'Buscar mensagens' }).click();
    await page.getByRole('searchbox', { name: 'Buscar mensagens' }).fill(text);
    await page.keyboard.press('Enter');
    await expect(page.getByRole('complementary', { name: 'Busca' })).toContainText(text);
    await expect(box).toBeHidden();
    await page.getByRole('button', { name: 'Fechar busca' }).click();
    await expect(box).toBeVisible();

    await page.getByRole('button', { name: 'Mensagens fixadas' }).click();
    await expect(page.getByRole('complementary', { name: 'Mensagens fixadas' })).toBeVisible();
    await expect(box).toBeHidden();
    await page.getByRole('button', { name: 'Fechar mensagens fixadas' }).click();
    await expect(box).toBeVisible();
    await ana.context.close();
  });

  test('ao toque, as ações da mensagem aparecem sem passar o mouse', async ({ browser }) => {
    const ana = await openPerson(browser, 'Ana', { viewport: PHONE, touch: true });
    const { page } = ana;
    const text = uniqueName('toque');
    await send(page, text);
    const row = page.locator('[data-message-id]').filter({ hasText: text });
    await expect(row.getByRole('button', { name: 'Reagir' })).toHaveCSS('opacity', '1');
    await expect(row.getByRole('button', { name: 'Responder' })).toHaveCSS('opacity', '1');
    await ana.context.close();
  });

  test('tocar e segurar numa pessoa da chamada abre o volume só seu', async ({ browser }) => {
    const ana = await openPerson(browser, 'Ana', { viewport: PHONE, touch: true });
    const bruno = await openPerson(browser, 'Bruno');
    await joinCall(bruno.page);
    await ana.page.getByRole('button', { name: 'Voltar à lista' }).click();
    await ana.page.getByRole('button', { name: 'Sala de estar', exact: true }).click();
    await expect(ana.page.getByRole('heading', { level: 2, name: 'Sala de estar' })).toBeVisible();
    const tile = ana.page.getByRole('listitem').filter({ hasText: bruno.name }).first();
    await tile.dispatchEvent('pointerdown', { pointerType: 'touch', clientX: 120, clientY: 300 });
    await ana.page.waitForTimeout(650);
    await expect(ana.page.getByRole('dialog', { name: `Volume de ${bruno.name}` })).toBeVisible();
    await Promise.all([ana, bruno].map((p) => p.context.close()));
  });

  test('no celular, as configurações abrem numa lista de categorias e cada uma ocupa a tela com Voltar', async ({ browser }) => {
    const ana = await openPerson(browser, 'Ana', { viewport: PHONE });
    const { page } = ana;
    await page.getByRole('button', { name: 'Voltar à lista' }).click();
    await page.getByRole('button', { name: 'Configurações' }).first().click();
    const categories = page.getByRole('navigation', { name: 'Categorias' });
    await expect(categories).toBeVisible();
    await expect(page.getByRole('heading', { level: 2, name: 'Voz e vídeo' })).toBeHidden();

    await categories.getByRole('button', { name: 'Sons' }).click();
    await expect(page.getByRole('heading', { level: 2, name: 'Sons' })).toBeVisible();
    await expect(categories).toBeHidden();

    await page.getByRole('button', { name: 'Voltar', exact: true }).click();
    await expect(categories).toBeVisible();

    await page.getByRole('button', { name: 'Fechar configurações' }).click();
    await expect(categories).toBeHidden();
    await ana.context.close();
  });

  test('no computador as configurações mostram categorias e conteúdo lado a lado', async ({ browser }) => {
    const ana = await openPerson(browser, 'Ana');
    const { page } = ana;
    await page.getByRole('button', { name: 'Configurações' }).first().click();
    await expect(page.getByRole('navigation', { name: 'Categorias' })).toBeVisible();
    await expect(page.getByRole('heading', { level: 2, name: 'Voz e vídeo' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Voltar', exact: true })).toBeHidden();
    await ana.context.close();
  });

  test('nenhuma tela do celular rola para os lados', async ({ browser }) => {
    const ana = await openPerson(browser, 'Ana', { viewport: PHONE });
    const bruno = await openPerson(browser, 'Bruno');
    await joinCall(bruno.page);
    const { page } = ana;
    const fits = async (where: string) => {
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      expect(overflow, `rolagem horizontal em: ${where}`).toBeLessThanOrEqual(0);
    };
    await fits('conversa');
    await page.getByRole('button', { name: 'Mostrar membros' }).click();
    await fits('membros');
    await page.getByRole('button', { name: 'Fechar membros' }).click();
    await page.getByRole('button', { name: 'Buscar mensagens' }).click();
    await fits('busca');
    await page.getByRole('button', { name: 'Fechar busca' }).click();
    await page.getByRole('button', { name: 'Voltar à lista' }).click();
    await fits('lista');
    await page.getByRole('button', { name: 'Sala de estar', exact: true }).click();
    await expect(page.getByRole('heading', { level: 2, name: 'Sala de estar' })).toBeVisible();
    await fits('chamada');
    await page.getByRole('button', { name: 'Voltar à lista' }).first().click();
    await page.getByRole('button', { name: 'Configurações' }).first().click();
    await fits('configurações (lista)');
    await page.getByRole('navigation', { name: 'Categorias' }).getByRole('button', { name: 'Voz e vídeo' }).click();
    await fits('configurações (voz e vídeo)');
    await Promise.all([ana, bruno].map((p) => p.context.close()));
  });

  test('de lado (celular deitado) o campo de mensagem continua à vista', async ({ browser }) => {
    const ana = await openPerson(browser, 'Ana', { viewport: { width: 844, height: 390 } });
    await expect(ana.page.getByRole('textbox', { name: 'Mensagem para #geral' })).toBeVisible();
    await ana.context.close();
  });

  test('no celular, a tela fica ligada durante a chamada e o sistema mostra "em chamada" com sair e microfone', async ({ browser }) => {
    const ana = await openPerson(browser, 'Ana', { viewport: PHONE, touch: true });
    const { page } = ana;
    await spyOnSystem(page);
    await page.getByRole('button', { name: 'Voltar à lista' }).click();
    await page.getByRole('button', { name: 'Sala de estar', exact: true }).click();
    await expect(page.getByRole('heading', { level: 2, name: 'Sala de estar' })).toBeVisible();

    await expect.poll(() => locks(page)).toBe(1);
    await expect.poll(() => page.evaluate(() => navigator.mediaSession.metadata?.title)).toBe('Sala de estar');
    const handlers = await page.evaluate(() => Object.keys((window as unknown as { __handlers: object }).__handlers));
    expect(handlers).toEqual(expect.arrayContaining(['hangup', 'togglemicrophone']));

    // O botão "desligar" da notificação do sistema sai da chamada.
    await page.evaluate(() => (window as unknown as { __handlers: Record<string, () => void> }).__handlers.hangup());
    await expect(page.getByRole('region', { name: 'Chamada em andamento' })).toHaveCount(0);
    await expect.poll(() => locks(page)).toBe(0);
    await expect.poll(() => page.evaluate(() => navigator.mediaSession.metadata)).toBeNull();
    await ana.context.close();
  });

  test('no computador a chamada não segura a tela ligada', async ({ browser }) => {
    const ana = await openPerson(browser, 'Ana');
    const { page } = ana;
    await spyOnSystem(page);
    await joinCall(page);
    await page.waitForTimeout(500);
    expect(await locks(page)).toBe(0);
    await ana.context.close();
  });

  test('no computador a lista de membros começa aberta ao lado da conversa', async ({ browser }) => {
    const ana = await openPerson(browser, 'Ana');
    const { page } = ana;
    await expect(page.getByRole('complementary', { name: 'Membros' })).toBeVisible();
    await expect(page.getByRole('textbox', { name: 'Mensagem para #geral' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Buscar mensagens' })).toBeHidden();
    await ana.context.close();
  });

  test('no computador o botão Voltar à lista não aparece e as três colunas ficam juntas', async ({ browser }) => {
    const ana = await openPerson(browser, 'Ana');
    const { page } = ana;
    await expect(page.getByRole('button', { name: 'Voltar à lista' })).toBeHidden();
    await expect(page.getByRole('navigation', { name: 'Espaços' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'geral', exact: true }).first()).toBeVisible();
    await expect(page.getByRole('textbox', { name: 'Mensagem para #geral' })).toBeVisible();
    await ana.context.close();
  });
});
