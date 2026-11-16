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
      localStorage.setItem(key, JSON.stringify({ ...saved, voice: { ...(saved.voice ?? {}), outputVolume: 2, levelVoices: false } }));
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

  test('igualar o volume sobe a voz de quem fala baixo, e desligar volta ao normal na hora', async ({ browser }) => {
    test.setTimeout(90_000);
    const ana = await openPerson(browser, 'Ana');
    const bruno = await openPerson(browser, 'Bruno');
    // A Ana registra os nós de ganho que a página cria. E a voz do Bruno que ela mede é sintética: baixa (cerca de -37 dB)
    // e constante. O microfone falso do navegador só faz bipes curtos, cujo nível varia de máquina para máquina (no CI o
    // teste ficava 40 s sem ver o ganho subir). Só o medidor do nivelador (fftSize 2048) é trocado; o de "quem está falando"
    // (512) segue real.
    await ana.page.addInitScript(() => {
      const gains: GainNode[] = [];
      (window as unknown as { __gains: GainNode[] }).__gains = gains;
      const create = AudioContext.prototype.createGain;
      AudioContext.prototype.createGain = function (this: AudioContext) {
        const node = create.call(this);
        gains.push(node);
        return node;
      };
      const read = AnalyserNode.prototype.getFloatTimeDomainData;
      AnalyserNode.prototype.getFloatTimeDomainData = function (this: AnalyserNode, array: Float32Array<ArrayBuffer>) {
        if (this.fftSize !== 2048) return read.call(this, array);
        for (let i = 0; i < array.length; i++) array[i] = 0.02 * Math.sin(i / 3);
      };
    });
    await Promise.all([ana.page.reload(), bruno.page.reload()]);
    await joinCall(ana.page);
    await joinCall(bruno.page);

    // Os ganhos que passam de 1 mas não são os fixos do limitador (4) nem o volume geral (1): o do nivelador.
    const boosts = () =>
      ana.page.evaluate(() =>
        (window as unknown as { __gains: GainNode[] }).__gains.map((g) => g.gain.value).filter((v) => v > 1.15 && v < 3.9).length,
      );
    // O nivelador é lento de propósito (sobe 2,5 dB por segundo de fala), então basta ele começar a subir.
    await expect.poll(boosts, { timeout: 40_000, intervals: [500] }).toBeGreaterThan(0);

    await ana.page.getByRole('button', { name: 'Configurações' }).first().click();
    const toggle = ana.page.getByRole('switch', { name: 'Igualar o volume das vozes' });
    await expect(toggle).toHaveAttribute('aria-checked', 'true');
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-checked', 'false');
    await expect.poll(boosts, { timeout: 10_000 }).toBe(0);
    await Promise.all([ana, bruno].map((p) => p.context.close()));
  });
});

test.describe('atalhos de teclado', () => {
  test('grava o atalho de mutar, recusa o que já está em uso e remove', async ({ browser }) => {
    const ana = await openPerson(browser, 'Ana');
    const { page } = ana;
    await page.getByRole('button', { name: 'Configurações' }).click();
    await page.getByRole('button', { name: 'Atalhos', exact: true }).click();

    const mute = page.locator('div.border-b', { hasText: 'Ativar/desativar microfone' });
    await mute.getByRole('button', { name: 'Gravar' }).click();
    await page.keyboard.press('Shift+KeyV');
    await expect(mute).toContainText('Shift + V');

    // O mesmo atalho no outro botão é recusado.
    const deafen = page.locator('div.border-b', { hasText: 'Ativar/desativar som' });
    await deafen.getByRole('button', { name: 'Gravar' }).click();
    await page.keyboard.press('Shift+KeyV');
    await expect(page.getByRole('alert')).toContainText('já está em uso');
    await expect(deafen).toContainText('Sem atalho');

    // Fica guardado ao recarregar e dá para remover.
    await page.reload();
    await page.getByRole('button', { name: 'Configurações' }).click();
    await page.getByRole('button', { name: 'Atalhos', exact: true }).click();
    await expect(mute).toContainText('Shift + V');
    await mute.getByRole('button', { name: /Remover o atalho de/ }).click();
    await expect(mute).toContainText('Sem atalho');
    await ana.context.close();
  });
});
