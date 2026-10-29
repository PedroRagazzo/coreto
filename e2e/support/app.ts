// Atalhos para os testes do site: criar uma pessoa (contexto de navegador próprio, já logada), a tela simulada para
// transmitir e o que se repete nas conversas.

import { expect, type Browser, type BrowserContext, type Page } from '@playwright/test';

export const PIN = '4827';
let counter = 0;

/** Um nome único por pessoa: os testes dividem o mesmo banco. */
export const uniqueName = (label: string) => `${label} ${Date.now().toString(36).slice(-4)}${++counter}`;

export interface Person {
  name: string;
  context: BrowserContext;
  page: Page;
}

/**
 * `getDisplayMedia` falso: uma tela de `width`×`height` desenhada num canvas, no lugar do seletor de tela do sistema,
 * que um teste automático não consegue operar.
 */
const FAKE_SCREEN = ({ label, color, width, height }: { label: string; color: string; width: number; height: number }) => {
  navigator.mediaDevices.getDisplayMedia = async () => {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d')!;
    let tick = 0;
    const draw = () => {
      tick++;
      ctx.fillStyle = color;
      ctx.fillRect(0, 0, width, height);
      ctx.fillStyle = '#fff';
      ctx.font = '64px sans-serif';
      ctx.fillText(label, 60, 140);
      ctx.fillRect((tick * 8) % (width - 100), height - 140, 100, 100);
    };
    draw();
    setInterval(draw, 66);
    return canvas.captureStream(15);
  };
};

/** Guarda cada conexão WebRTC que a página abre, para os testes lerem as estatísticas (a voz chegou de verdade?). */
const TRACK_PEERS = () => {
  const Original = window.RTCPeerConnection;
  const all: RTCPeerConnection[] = [];
  (window as unknown as { __peers: RTCPeerConnection[] }).__peers = all;
  window.RTCPeerConnection = new Proxy(Original, {
    construct(target, args: ConstructorParameters<typeof RTCPeerConnection>) {
      const pc = new target(...args);
      all.push(pc);
      return pc;
    },
  });
};

export interface FakeScreen {
  label?: string;
  color?: string;
  width?: number;
  height?: number;
}

/** Abre o site numa janela nova, cria a conta (ou entra nela) e espera o app abrir. */
export async function openPerson(
  browser: Browser,
  label: string,
  options: { viewport?: { width: number; height: number }; screen?: FakeScreen; name?: string } = {},
): Promise<Person> {
  const name = options.name ?? uniqueName(label);
  const context = await browser.newContext({
    viewport: options.viewport ?? { width: 1280, height: 800 },
    locale: 'pt-BR',
    acceptDownloads: true,
  });
  await context.addInitScript(TRACK_PEERS);
  if (options.screen) {
    const { label: screenLabel = `Tela de ${name}`, color = '#7a2d9e', width = 1280, height = 720 } = options.screen;
    await context.addInitScript(FAKE_SCREEN, { label: screenLabel, color, width, height });
  }
  const page = await context.newPage();
  await signIn(page, name);
  return { name, context, page };
}

/** Entra com nome e PIN (cria a conta na primeira vez). */
export async function signIn(page: Page, name: string, pin = PIN): Promise<void> {
  await page.goto('/');
  await page.getByPlaceholder('Seu nome').fill(name);
  await page.getByPlaceholder('••••').fill(pin);
  await page.getByRole('button', { name: 'Entrar', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'Mensagem para #geral' })).toBeVisible();
}

/** Escreve e envia uma mensagem no canal aberto. */
export async function send(page: Page, text: string): Promise<void> {
  const box = page.getByRole('textbox', { name: /^Mensagem para / });
  await box.fill(text);
  await box.press('Enter');
}

/**
 * A linha de uma mensagem na conversa, achada pelo texto. Uma resposta também cita o texto da original: `.first()` é a
 * original, que vem antes.
 */
export const messageRow = (page: Page, text: string) => page.locator('[data-message-id]').filter({ hasText: text });

/** Passa o mouse na mensagem (os botões de ação só aparecem assim) e devolve a linha dela. */
export async function hoverMessage(page: Page, text: string) {
  const row = messageRow(page, text).first();
  await row.hover();
  return row;
}

/** Entra na sala de voz "Sala de estar" e espera a chamada conectar. */
export async function joinCall(page: Page): Promise<void> {
  // O "Entrar em…" do botão é só uma dica (title): o nome dele é o do canal.
  await page.getByRole('button', { name: 'Sala de estar', exact: true }).click();
  await expect(page.getByText('Voz conectada')).toBeVisible();
}

/** Começa a transmitir a tela (a falsa, se a pessoa foi aberta com `screen`) e espera a prévia abrir no palco. */
export async function startScreen(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Tela', exact: true }).click();
  await page.getByRole('button', { name: 'Escolher tela' }).click();
  await expect(page.getByRole('region', { name: 'Sua tela' })).toBeVisible();
}

/** Quantos bytes de voz a página já recebeu de outras pessoas (de todas as conexões WebRTC dela). */
export function audioBytesReceived(page: Page): Promise<number> {
  return page.evaluate(async () => {
    const peers = (window as unknown as { __peers?: RTCPeerConnection[] }).__peers ?? [];
    let bytes = 0;
    for (const pc of peers) {
      (await pc.getStats()).forEach((report) => {
        if (report.type === 'inbound-rtp' && report.kind === 'audio') bytes += report.bytesReceived ?? 0;
      });
    }
    return bytes;
  });
}
