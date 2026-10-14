// @ts-check
// Gera build/icon.png (512x512) a partir do favicon do site, para o instalador
// e a janela usarem o mesmo desenho. O electron-builder converte para .ico.
import { Resvg } from '@resvg/resvg-js';
import { readFileSync, writeFileSync } from 'node:fs';

const svg = readFileSync(new URL('../../client/public/favicon.svg', import.meta.url), 'utf8');
const png = new Resvg(svg, { fitTo: { mode: 'width', value: 512 } }).render().asPng();
writeFileSync(new URL('../build/icon.png', import.meta.url), png);
console.log(`build/icon.png: ${png.length} bytes`);
