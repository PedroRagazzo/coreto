// @ts-check
// Página local para quando o servidor não responde. Tenta de novo sozinha a cada 10 s.
const params = new URLSearchParams(location.search);
const url = params.get('url') ?? '';

/** @type {HTMLElement} */ (document.getElementById('url')).textContent = url;
/** @type {HTMLElement} */ (document.getElementById('erro')).textContent = params.get('erro') ?? '';

const retry = () => {
  // O processo principal só deixa a janela navegar para o servidor do Coreto.
  if (url.startsWith('https://') || url.startsWith('http://')) location.href = url;
};
document.getElementById('retry')?.addEventListener('click', retry);
setTimeout(retry, 10_000);
