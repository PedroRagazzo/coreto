import { readFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import { formatBytes } from '../../shared/src/files';
import { messageRow, openPerson, uniqueName } from '../support/app';
import { png } from '../support/files';

test.describe('anexos', () => {
  test('um arquivo vira um cartão que os outros baixam inteiro', async ({ browser }) => {
    const ana = await openPerson(browser, 'Ana');
    const bruno = await openPerson(browser, 'Bruno');
    const text = uniqueName('segue o relatório');
    const content = Buffer.from('conteúdo do relatório\n'.repeat(500));

    await ana.page.locator('input[type=file]').setInputFiles({ name: 'relatório final.pdf', mimeType: 'application/pdf', buffer: content });
    await ana.page.getByRole('textbox', { name: /^Mensagem para / }).fill(text);
    await ana.page.getByRole('textbox', { name: /^Mensagem para / }).press('Enter');

    const card = messageRow(bruno.page, text).getByRole('link', { name: /relatório final\.pdf/ });
    await expect(card).toBeVisible();
    await expect(card).toContainText(formatBytes(content.length));

    const [download] = await Promise.all([bruno.page.waitForEvent('download'), card.click()]);
    expect(download.suggestedFilename()).toBe('relatório final.pdf');
    expect((await readFile(await download.path())).equals(content)).toBe(true);
    await Promise.all([ana, bruno].map((p) => p.context.close()));
  });

  test('uma imagem aparece na própria conversa, e clicar a abre em tela cheia', async ({ browser }) => {
    const ana = await openPerson(browser, 'Ana');
    const bruno = await openPerson(browser, 'Bruno');
    const text = uniqueName('olha essa foto');

    await ana.page.locator('input[type=file]').setInputFiles({ name: 'foto.png', mimeType: 'image/png', buffer: png(320, 200) });
    await ana.page.getByRole('textbox', { name: /^Mensagem para / }).fill(text);
    await ana.page.getByRole('textbox', { name: /^Mensagem para / }).press('Enter');

    const image = messageRow(bruno.page, text).getByRole('img', { name: 'foto.png' });
    await expect(image).toBeVisible();
    // O navegador conseguiu decodificar: o servidor entregou uma imagem de verdade.
    await expect.poll(() => image.evaluate((img: HTMLImageElement) => img.naturalWidth)).toBe(320);

    await image.click();
    await expect(bruno.page.getByRole('dialog', { name: 'foto.png' })).toBeVisible();
    await bruno.page.keyboard.press('Escape');
    await expect(bruno.page.getByRole('dialog', { name: 'foto.png' })).toHaveCount(0);
    await Promise.all([ana, bruno].map((p) => p.context.close()));
  });

  test('um programa ou página enviada como arquivo nunca abre no navegador: só baixa', async ({ browser }) => {
    const ana = await openPerson(browser, 'Ana');
    const text = uniqueName('página suspeita');
    await ana.page.locator('input[type=file]').setInputFiles({
      name: 'pagina.html',
      mimeType: 'text/html',
      buffer: Buffer.from('<html><script>document.title = "executou"</script></html>'),
    });
    await ana.page.getByRole('textbox', { name: /^Mensagem para / }).fill(text);
    await ana.page.getByRole('textbox', { name: /^Mensagem para / }).press('Enter');

    const link = messageRow(ana.page, text).getByRole('link', { name: /pagina\.html/ });
    await expect(link).toBeVisible();
    const href = await link.getAttribute('href');
    const res = await ana.page.request.get(href!);
    expect(res.headers()['content-type']).toBe('application/octet-stream');
    expect(res.headers()['content-disposition']).toMatch(/^attachment;/);
    expect(res.headers()['x-content-type-options']).toBe('nosniff');
    await ana.context.close();
  });

  test('envia vários anexos de uma vez, até o limite de quatro por mensagem', async ({ browser }) => {
    const ana = await openPerson(browser, 'Ana');
    const files = Array.from({ length: 4 }, (_, i) => ({ name: `nota-${i + 1}.txt`, mimeType: 'text/plain', buffer: Buffer.from(`nota ${i + 1}`) }));
    await ana.page.locator('input[type=file]').setInputFiles(files);
    const text = uniqueName('quatro notas');
    await ana.page.getByRole('textbox', { name: /^Mensagem para / }).fill(text);
    await ana.page.getByRole('textbox', { name: /^Mensagem para / }).press('Enter');
    for (const file of files) await expect(messageRow(ana.page, text).getByRole('link', { name: new RegExp(file.name) })).toBeVisible();
    await ana.context.close();
  });
});
