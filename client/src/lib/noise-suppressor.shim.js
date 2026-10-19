// @ts-nocheck: escopo do AudioWorklet.
// O WebAssembly do RNNoise (e o Vite, ao empacotar) esperam `self` e `location`, que o AudioWorklet não tem.
// Este módulo é importado antes do RNNoise, então roda primeiro.
if (typeof self === 'undefined') globalThis.self = globalThis;
if (typeof location === 'undefined') globalThis.location = { href: '' };
