import { expect, test, type Page } from '@playwright/test';
import { audioBytesReceived, joinCall, openPerson } from '../support/app';

/** Abre Configurações, Diagnóstico, roda o teste e espera o resultado. */
async function runDiagnostics(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Configurações' }).first().click();
  await page.getByRole('navigation', { name: 'Categorias' }).getByRole('button', { name: 'Diagnóstico' }).click();
  await page.getByRole('button', { name: /Rodar diagnóstico|Testar de novo/ }).click();
  // O teste do microfone dura 3 s e a busca de caminhos de rede, até 8 s.
  await expect(page.getByRole('heading', { name: /^Resultado:/ })).toBeVisible({ timeout: 30_000 });
}

const check = (page: Page, id: string) => page.locator(`[data-check="${id}"]`);

test.describe('diagnóstico de conexão', () => {
  test('roda os testes, explica cada um e copia o resultado sem dados pessoais', async ({ browser }) => {
    const ana = await openPerson(browser, 'Ana');
    await ana.context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await runDiagnostics(ana.page);

    // Os seis testes aparecem, cada um com uma frase.
    await expect(ana.page.locator('[data-check]')).toHaveCount(6);
    await expect(check(ana.page, 'server')).toContainText('Conectado, resposta em');
    await expect(check(ana.page, 'mic')).toContainText('Microfone');
    await expect(check(ana.page, 'mic').getByRole('img', { name: 'Problema' })).toHaveCount(0);
    await expect(check(ana.page, 'call')).toContainText('Você não está em uma chamada.');

    // Os números por trás de cada veredito ficam em "Detalhes".
    await check(ana.page, 'network').getByText('Detalhes').click();
    await expect(check(ana.page, 'network')).toContainText('Caminhos locais');
    await check(ana.page, 'video').getByText('Detalhes').click();
    await expect(check(ana.page, 'video')).toContainText('Formatos de vídeo');

    await ana.page.getByRole('button', { name: 'Copiar diagnóstico' }).click();
    await expect(ana.page.getByRole('button', { name: 'Copiado!' })).toBeVisible();
    const copied = await ana.page.evaluate(() => navigator.clipboard.readText());
    expect(copied).toMatch(/^Diagnóstico do Coreto \(/);
    expect(copied).toContain('[INFO] Este computador');
    expect(copied).toContain('Servidor do Coreto: Conectado, resposta em');

    // Nada que identifique a pessoa: nem o nome, nem a sessão.
    const token = await ana.page.evaluate(() => (JSON.parse(localStorage.getItem('coreto.identity') ?? '{}') as { token?: string }).token ?? '');
    expect(token.length).toBeGreaterThan(16);
    expect(copied).not.toContain(token);
    expect(copied).not.toContain(ana.name);
    await ana.context.close();
  });

  test('pedidos HTTP que falham aparecem nos detalhes do servidor, sem travar o teste', async ({ browser }) => {
    const ana = await openPerson(browser, 'Ana');
    // Pedidos HTTP ao servidor falham; o socket aberto continua. O diagnóstico conta o que falhou, sem travar.
    await ana.page.route('**/health', (route) => route.abort('connectionreset'));
    await runDiagnostics(ana.page);
    await check(ana.page, 'server').getByText('Detalhes').click();
    await expect(check(ana.page, 'server')).toContainText('nenhum dos 4 pedidos respondeu');
    await ana.context.close();
  });

  test('numa chamada, mede a conexão com cada pessoa', async ({ browser }) => {
    test.setTimeout(90_000);
    const ana = await openPerson(browser, 'Ana');
    const bruno = await openPerson(browser, 'Bruno');
    await joinCall(ana.page);
    await joinCall(bruno.page);
    await expect.poll(() => audioBytesReceived(ana.page), { timeout: 20_000 }).toBeGreaterThan(2_000);
    // O indicador de conexão só aparece depois da primeira leitura das estatísticas.
    await expect(ana.page.getByRole('img', { name: /^Conexão (boa|oscilando|ruim)/ }).first()).toBeVisible({ timeout: 20_000 });

    await runDiagnostics(ana.page);
    await expect(check(ana.page, 'call')).not.toContainText('Você não está em uma chamada.');
    await expect(check(ana.page, 'call')).toContainText(/conexão da chamada está boa|1 de 1 conexões com problema/);
    await check(ana.page, 'call').getByText('Detalhes').click();
    await expect(check(ana.page, 'call')).toContainText('Pessoa 1');
    // Nem o nome do Bruno vai para o relatório.
    await expect(check(ana.page, 'call')).not.toContainText(bruno.name);
    await Promise.all([ana, bruno].map((p) => p.context.close()));
  });
});
