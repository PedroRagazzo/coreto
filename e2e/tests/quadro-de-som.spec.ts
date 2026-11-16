import { expect, test } from '@playwright/test';
import { joinCall, openPerson } from '../support/app';

/** Um WAV mudo de `seconds` segundos (8 kHz, 8 bits, mono): pequeno no arquivo, longo no relógio. */
function silentWav(seconds: number): Buffer {
  const rate = 8000;
  const data = Buffer.alloc(rate * seconds, 128);
  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + data.length, 4);
  header.write('WAVEfmt ', 8);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20); // PCM
  header.writeUInt16LE(1, 22); // mono
  header.writeUInt32LE(rate, 24);
  header.writeUInt32LE(rate, 28);
  header.writeUInt16LE(1, 32);
  header.writeUInt16LE(8, 34);
  header.write('data', 36);
  header.writeUInt32LE(data.length, 40);
  return Buffer.concat([header, data]);
}

test.describe('quadro de som', () => {
  test('aceita um som de mais de 8 segundos, que aparece para a chamada toda', async ({ browser }) => {
    const ana = await openPerson(browser, 'Ana');
    const bruno = await openPerson(browser, 'Bruno');
    await joinCall(ana.page);
    await joinCall(bruno.page);

    await bruno.page.getByRole('button', { name: 'Quadro de som' }).click();
    const dialog = bruno.page.getByRole('dialog', { name: 'Quadro de som' });
    await dialog.locator('input[type=file]').setInputFiles({ name: 'discurso.wav', mimeType: 'audio/wav', buffer: silentWav(45) });
    await dialog.getByRole('textbox', { name: 'Nome do som' }).fill('Discurso longo');
    await dialog.getByRole('button', { name: 'Acrescentar' }).click();

    // Sem recusa por duração: o som entra no quadro e dá para tocar.
    await expect(dialog.getByRole('alert')).toHaveCount(0);
    const clip = dialog.getByRole('button', { name: 'Discurso longo', exact: true });
    await expect(clip).toBeVisible();
    await clip.click();
    await expect(dialog.getByRole('alert')).toHaveCount(0);

    // A outra pessoa também vê o som no quadro.
    await ana.page.getByRole('button', { name: 'Quadro de som' }).click();
    await expect(ana.page.getByRole('dialog', { name: 'Quadro de som' }).getByRole('button', { name: 'Discurso longo', exact: true })).toBeVisible();
    await Promise.all([ana, bruno].map((p) => p.context.close()));
  });
});

test.describe('atalhos dos sons', () => {
  test('dá um atalho a um som e o toca com o quadro fechado', async ({ browser }) => {
    const ana = await openPerson(browser, 'Ana');
    const { page } = ana;
    await joinCall(page);

    await page.getByRole('button', { name: 'Quadro de som' }).click();
    const dialog = page.getByRole('dialog', { name: 'Quadro de som' });
    for (const name of ['Palmas', 'Buzina']) {
      await dialog.locator('input[type=file]').setInputFiles({ name: `${name}.wav`, mimeType: 'audio/wav', buffer: silentWav(2) });
      await dialog.getByRole('textbox', { name: 'Nome do som' }).fill(name);
      await dialog.getByRole('button', { name: 'Acrescentar' }).click();
      await expect(dialog.getByRole('button', { name, exact: true })).toBeVisible();
    }

    // Grava um atalho para "Palmas": a combinação aparece no próprio som.
    const palmas = dialog.getByRole('listitem').filter({ hasText: 'Palmas' });
    await palmas.hover();
    await palmas.getByRole('button', { name: 'Dar um atalho do som Palmas' }).click();
    await page.keyboard.press('Shift+KeyU');
    await expect(palmas).toContainText('Shift + U');

    // A mesma combinação em outro som é recusada.
    const buzina = dialog.getByRole('listitem').filter({ hasText: 'Buzina' });
    await buzina.hover();
    await buzina.getByRole('button', { name: 'Dar um atalho do som Buzina' }).click();
    await page.keyboard.press('Shift+KeyU');
    await expect(dialog.getByRole('alert')).toContainText('já está em uso');
    await expect(buzina).not.toContainText('Shift + U');

    // Com o quadro fechado, o atalho toca o som (o áudio é baixado na primeira vez que toca).
    await dialog.getByRole('button', { name: 'Fechar' }).click();
    await expect(dialog).toBeHidden();
    const played = page.waitForRequest((req) => req.method() === 'GET' && /\/sounds\/[^/?]+$/.test(new URL(req.url()).pathname));
    await page.keyboard.press('Shift+KeyU');
    await played;

    // Tirar o atalho some com a combinação do som.
    await page.getByRole('button', { name: 'Quadro de som' }).click();
    const again = page.getByRole('dialog', { name: 'Quadro de som' });
    const row = again.getByRole('listitem').filter({ hasText: 'Palmas' });
    await row.hover();
    await row.getByRole('button', { name: 'Remover o atalho do som Palmas' }).click();
    await expect(row).not.toContainText('Shift + U');
    await ana.context.close();
  });
});

test.describe('volume de cada som', () => {
  test('ajusta o volume de um som, que aparece no som, fica guardado e some com o som', async ({ browser }) => {
    const ana = await openPerson(browser, 'Ana');
    const { page } = ana;
    await joinCall(page);

    await page.getByRole('button', { name: 'Quadro de som' }).click();
    const dialog = page.getByRole('dialog', { name: 'Quadro de som' });
    await dialog.locator('input[type=file]').setInputFiles({ name: 'sirene.wav', mimeType: 'audio/wav', buffer: silentWav(2) });
    await dialog.getByRole('textbox', { name: 'Nome do som' }).fill('Sirene');
    await dialog.getByRole('button', { name: 'Acrescentar' }).click();
    const tile = dialog.getByRole('listitem').filter({ hasText: 'Sirene' });
    await expect(tile).toBeVisible();

    // Sem ajuste, o som não mostra volume nenhum; o controle começa em 100%.
    await tile.hover();
    await tile.getByRole('button', { name: 'Ajustar o volume do som Sirene' }).click();
    const slider = tile.getByRole('slider', { name: 'Volume do som Sirene' });
    await expect(slider).toHaveValue('100');
    await slider.fill('150');
    await expect(tile).toContainText('150%');
    await tile.getByRole('button', { name: 'Fechar o volume do som Sirene' }).click();
    await expect(tile).toContainText('150%');

    // Fica guardado neste aparelho.
    await page.reload();
    await joinCall(page);
    await page.getByRole('button', { name: 'Quadro de som' }).click();
    const again = page.getByRole('dialog', { name: 'Quadro de som' }).getByRole('listitem').filter({ hasText: 'Sirene' });
    await expect(again).toContainText('150%');

    // Voltar a 100% tira a marca do som.
    await again.hover();
    await again.getByRole('button', { name: 'Ajustar o volume do som Sirene' }).click();
    await again.getByRole('slider', { name: 'Volume do som Sirene' }).fill('100');
    await again.getByRole('button', { name: 'Fechar o volume do som Sirene' }).click();
    await expect(again).not.toContainText('%');
    await ana.context.close();
  });
});
