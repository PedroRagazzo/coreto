// @ts-check
// Gera os ícones do app a partir do favicon do site, para tudo usar o mesmo desenho:
//   build/icon.png (512x512)  instalador e janela (o electron-builder converte para .ico)
//   src/assets/tray.png e tray@2x.png (16 e 32 px)  bandeja do Windows; o Electron
//   escolhe o @2x sozinho em telas de alta densidade.
import { Resvg } from '@resvg/resvg-js';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';

const svg = readFileSync(new URL('../../client/public/favicon.svg', import.meta.url), 'utf8');
const render = (/** @type {number} */ size) => new Resvg(svg, { fitTo: { mode: 'width', value: size } }).render().asPng();

mkdirSync(new URL('../src/assets/', import.meta.url), { recursive: true });
const outputs = [
  ['../build/icon.png', 512],
  ['../src/assets/tray.png', 16],
  ['../src/assets/tray@2x.png', 32],
];
for (const [path, size] of /** @type {[string, number][]} */ (outputs)) {
  const png = render(size);
  writeFileSync(new URL(path, import.meta.url), png);
  console.log(`${path.replace('../', '')}: ${size}px, ${png.length} bytes`);
}
