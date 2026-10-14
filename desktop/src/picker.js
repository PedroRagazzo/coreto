// @ts-check
// Seletor de tela: telas e janelas em abas, como no Discord. Clique escolhe,
// duplo clique compartilha direto; Esc cancela.

/** @typedef {{ id: string; name: string; kind: 'screen' | 'window'; thumbnail: string; icon: string | null }} Source */
/** @type {{ sources(): Promise<Source[]>; choose(id: string | null): void }} */
const picker = /** @type {any} */ (window).coretoPicker;

const list = /** @type {HTMLUListElement} */ (document.getElementById('sources'));
const share = /** @type {HTMLButtonElement} */ (document.getElementById('share'));
const tabs = /** @type {HTMLButtonElement[]} */ ([...document.querySelectorAll('[role=tab]')]);
/** @type {Source[]} */
let sources = [];
let kind = 'screen';
/** @type {string | null} */
let selected = null;

function render() {
  list.replaceChildren(
    ...sources
      .filter((s) => s.kind === kind)
      .map((source) => {
        const item = document.createElement('li');
        item.role = 'option';
        item.tabIndex = 0;
        item.ariaSelected = String(source.id === selected);
        const img = document.createElement('img');
        img.src = source.thumbnail;
        img.alt = '';
        const label = document.createElement('span');
        if (source.icon) {
          const icon = document.createElement('img');
          icon.src = source.icon;
          icon.alt = '';
          icon.className = 'icon';
          label.append(icon);
        }
        label.append(source.name);
        item.append(img, label);
        item.addEventListener('click', () => select(source.id));
        item.addEventListener('dblclick', () => picker.choose(source.id));
        item.addEventListener('keydown', (e) => {
          if (e.key === 'Enter') picker.choose(source.id);
        });
        return item;
      }),
  );
  share.disabled = selected === null;
}

/** @param {string} id */
function select(id) {
  selected = id;
  render();
}

for (const tab of tabs) {
  tab.addEventListener('click', () => {
    kind = tab.dataset.kind ?? 'screen';
    for (const t of tabs) t.ariaSelected = String(t === tab);
    render();
  });
}
share.addEventListener('click', () => selected && picker.choose(selected));
document.getElementById('cancel')?.addEventListener('click', () => picker.choose(null));
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') picker.choose(null);
});

picker.sources().then((all) => {
  sources = all;
  // Com uma tela só, ela já vem escolhida.
  const screens = all.filter((s) => s.kind === 'screen');
  if (screens.length === 1) selected = screens[0].id;
  render();
});
