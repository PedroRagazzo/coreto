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
