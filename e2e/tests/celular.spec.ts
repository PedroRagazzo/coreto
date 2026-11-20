import { expect, test } from '@playwright/test';
import { joinCall, openPerson, startScreen } from '../support/app';

const PHONE = { width: 390, height: 844 };

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
