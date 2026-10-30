// As novidades que a janelinha "O que há de novo" mostra depois que o site atualiza.
//
// COMO ACRESCENTAR: a cada mudança que as pessoas notam (função nova, mudança de uso, versão nova do app), ponha uma
// entrada NO COMEÇO da lista `CHANGELOG`, com um `id` novo (a data, `AAAA-MM-DD`; se houver duas no mesmo dia, `-2`).
// Escreva para quem usa, sem termo técnico. A janelinha mostra, uma vez só, o que a pessoa ainda não viu, e a seção
// Novidades das configurações guarda o histórico. Quem acabou de criar a conta não vê nada (é tudo novidade para ela).

export interface ChangelogItem {
  /** O nome da novidade, em negrito. */
  title: string;
  /** Uma ou duas frases dizendo o que é e como usar. */
  text: string;
}

export interface ChangelogEntry {
  /** `AAAA-MM-DD` (com `-2`, `-3`... se houver mais de uma no dia). É o que a pessoa já viu, guardado no navegador. */
  id: string;
  title: string;
  items: ChangelogItem[];
}

/** Da mais nova para a mais antiga. */
export const CHANGELOG: ChangelogEntry[] = [
  {
    id: '2026-10-30',
    title: 'Transmissão melhor para jogos',
    items: [
      {
        title: 'Receita "Jogo ou vídeo"',
        text: 'Ao compartilhar a tela, um botão escolhe de uma vez 1080p, 60 fps e Fluidez, o que deixa o jogo rápido muito mais suave. "Tela e texto" volta para o modo de leitura.',
      },
      {
        title: 'Mais qualidade na imagem',
        text: 'O vídeo agora pode usar mais da sua internet de envio, o que reduz os blocos e a imagem borrada quando o jogo tem muito movimento.',
      },
      {
        title: 'Estatísticas que explicam o problema',
        text: 'No botão de estatísticas da transmissão, quem assiste vê quantas vezes a imagem travou e quem transmite vê quanto a rede comporta, com uma dica do que fazer.',
      },
    ],
  },
  {
    id: '2026-10-28-3',
    title: 'Transmissões e câmeras se ajustam à janela',
    items: [
      {
        title: 'Monitor em pé e janelas estreitas',
        text: 'As transmissões e as câmeras agora escolhem sozinhas como se organizar para ficarem o maior possível: lado a lado numa janela larga, uma sobre a outra numa janela em pé.',
      },
    ],
  },
  {
    id: '2026-10-28-2',
    title: 'Arquivos expiram em 20 dias',
    items: [
      {
        title: 'Arquivos e imagens somem depois de 20 dias',
        text: 'Para o servidor não encher, o arquivo de cada anexo é apagado 20 dias depois do envio. A mensagem fica, com um aviso no lugar. Guarde o que quiser manter.',
      },
    ],
  },
  {
    id: '2026-10-28',
    title: 'O que há de novo',
    items: [
      {
        title: 'Enviar arquivos',
        text: 'Pelo clipe, envie qualquer arquivo (até 50 MB). Imagens continuam aparecendo na conversa; o resto vira um cartão para baixar.',
      },
      {
        title: 'Enquetes e roleta',
        text: 'O botão de gráfico, ao lado do clipe, cria uma enquete (cada um vota com um clique) ou uma roleta que sorteia uma opção para todo mundo.',
      },
      {
        title: 'Fixar mensagens',
        text: 'Passe o mouse numa mensagem e clique no alfinete. As fixadas ficam na lista do alfinete, no topo do canal.',
      },
      {
        title: 'Quadro de som',
        text: 'Na chamada, toque sons curtos para todo mundo ouvir, até com o microfone mutado. Cada um pode acrescentar os seus.',
      },
      {
        title: 'Conexão na chamada',
        text: 'Barrinhas ao lado de cada pessoa mostram se a conexão dela está boa. Passe o mouse para ver ping e perda de pacotes.',
      },
      {
        title: 'Atalhos em jogos (app de desktop 0.7.0)',
        text: 'Os atalhos de mutar agora funcionam com jogos em tela cheia, até com uma tecla sozinha. Atualize o app do Windows para usar.',
      },
    ],
  },
];

/**
 * As entradas que a pessoa ainda não viu, da mais nova para a mais antiga, no máximo `limit`. `seenId` é a última que ela
 * viu (`null` se nunca viu nenhuma): sem ele, ou com um id que não existe mais, só a mais nova conta.
 */
export function unseenEntries(entries: readonly ChangelogEntry[], seenId: string | null, limit = 3): ChangelogEntry[] {
  if (entries.length === 0) return [];
  const seenAt = seenId === null ? -1 : entries.findIndex((entry) => entry.id === seenId);
  if (seenAt === -1) return [entries[0]!];
  return entries.slice(0, seenAt).slice(0, limit);
}
