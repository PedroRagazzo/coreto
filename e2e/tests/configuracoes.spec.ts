import { expect, test } from '@playwright/test';
import { audioBytesReceived, joinCall, openPerson } from '../support/app';

test.describe('configurações de voz', () => {
  test('o volume das chamadas vai até 200% e continua assim depois de recarregar', async ({ browser }) => {
    const ana = await openPerson(browser, 'Ana');
    await ana.page.getByRole('button', { name: 'Configurações' }).click();
    const slider = ana.page.getByRole('slider', { name: /Volume das chamadas/ });
    await expect(slider).toHaveAttribute('max', '2');
    await expect(slider).toHaveValue('1');

    await slider.fill('2');
    await expect(ana.page.getByText('200%', { exact: true }).first()).toBeVisible();

    await ana.page.reload();
    await ana.page.getByRole('button', { name: 'Configurações' }).click();
    await expect(ana.page.getByRole('slider', { name: /Volume das chamadas/ })).toHaveValue('2');
    await ana.context.close();
  });

  test('com o volume acima de 100% a chamada continua funcionando e o ganho é aplicado de verdade', async ({ browser }) => {
    const ana = await openPerson(browser, 'Ana');
    const bruno = await openPerson(browser, 'Bruno');
    // Guardado antes de entrar: a chamada já nasce com o ganho extra.
    await ana.page.evaluate(() => {
      const key = 'coreto.settings';
      const saved = JSON.parse(localStorage.getItem(key) ?? '{}');
      localStorage.setItem(key, JSON.stringify({ ...saved, voice: { ...(saved.voice ?? {}), outputVolume: 2 } }));
    });
    // Registra os nós de ganho que a página cria, para ler o ganho que a voz de verdade recebeu.
    await ana.page.addInitScript(() => {
      const gains: GainNode[] = [];
      (window as unknown as { __gains: GainNode[] }).__gains = gains;
      const create = AudioContext.prototype.createGain;
      AudioContext.prototype.createGain = function (this: AudioContext) {
        const node = create.call(this);
        gains.push(node);
        return node;
      };
    });
    await ana.page.reload();
    await joinCall(ana.page);
    await joinCall(bruno.page);
    await expect.poll(() => audioBytesReceived(ana.page), { timeout: 20_000 }).toBeGreaterThan(2_000);

    // A voz do Bruno toca com o dobro do ganho (o elemento de áudio vai a 100% e o resto é ganho).
    const gainValues = () => ana.page.evaluate(() => (window as unknown as { __gains: GainNode[] }).__gains.map((g) => Math.round(g.gain.value * 100) / 100));
    await expect.poll(gainValues, { timeout: 10_000 }).toContain(2);

    // Baixar o volume no meio da chamada tira o ganho extra na hora.
    await ana.page.getByRole('button', { name: 'Configurações' }).first().click();
    await ana.page.getByRole('slider', { name: /Volume das chamadas/ }).fill('0.5');
    await expect.poll(gainValues, { timeout: 10_000 }).not.toContain(2);
    await Promise.all([ana, bruno].map((p) => p.context.close()));
  });
});
