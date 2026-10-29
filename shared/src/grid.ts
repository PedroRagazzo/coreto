// Quantas colunas usar para encaixar vários vídeos (câmeras, transmissões) num espaço, qualquer que seja o formato dele:
// uma janela larga pede colunas lado a lado, um monitor em pé pede uma pilha. A escolha é a que deixa cada vídeo maior.

export interface GridInput {
  /** O espaço disponível, em pixels. */
  width: number;
  height: number;
  /** Quantos vídeos. */
  count: number;
  /** Largura ÷ altura de cada vídeo (padrão 16:9). */
  aspect?: number;
  /** Espaço entre os vídeos, em pixels. */
  gap?: number;
  /** Altura fixa extra de cada quadro além do vídeo (um cabeçalho, por exemplo), em pixels. */
  extraHeight?: number;
  /**
   * Largura mínima aceitável de um vídeo. Se nem o melhor arranjo chega nela, os vídeos ficam dessa largura e o espaço
   * passa a rolar, em vez de ficarem minúsculos.
   */
  minTileWidth?: number;
}

export interface GridPlan {
  columns: number;
  rows: number;
  /** Largura de cada vídeo, em pixels inteiros. */
  tileWidth: number;
  /** Não cabe tudo no espaço: o conteúdo precisa rolar na vertical. */
  scrolls: boolean;
}

export const VIDEO_ASPECT = 16 / 9;

/** O arranjo (colunas × linhas) em que o maior vídeo possível cabe no espaço; em empate, o de menos colunas. */
export function bestGrid({ width, height, count, aspect = VIDEO_ASPECT, gap = 0, extraHeight = 0, minTileWidth = 0 }: GridInput): GridPlan {
  if (count <= 1 || width <= 0 || height <= 0) {
    const tileWidth = Math.max(0, Math.floor(count <= 1 ? Math.min(width, Math.max(0, height - extraHeight) * aspect) : width));
    return { columns: 1, rows: Math.max(count, 1), tileWidth, scrolls: false };
  }

  let best: GridPlan | null = null;
  for (let columns = 1; columns <= count; columns++) {
    const rows = Math.ceil(count / columns);
    const cellWidth = (width - gap * (columns - 1)) / columns;
    const cellHeight = (height - gap * (rows - 1)) / rows;
    const tileWidth = Math.floor(Math.min(cellWidth, (cellHeight - extraHeight) * aspect));
    if (tileWidth > (best?.tileWidth ?? 0)) best = { columns, rows, tileWidth, scrolls: false };
  }
  if (best && best.tileWidth >= minTileWidth) return best;

  // Nem o melhor arranjo dá o mínimo: vídeos no tamanho mínimo, quantos couberem por linha, e o resto rola.
  const columns = Math.min(count, Math.max(1, Math.floor((width + gap) / (minTileWidth + gap))));
  return {
    columns,
    rows: Math.ceil(count / columns),
    tileWidth: Math.floor((width - gap * (columns - 1)) / columns),
    scrolls: true,
  };
}
