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
    id: '2026-11-14-7',
    title: 'Estatísticas da transmissão mais claras',
    items: [
      {
        title: 'Tamanho da captura no painel',
        text: 'No painel de quem transmite, a linha "captura" agora mostra também o tamanho da tela capturada. Se a imagem for reduzida antes de enviar, aparece quanto. Assim dá para saber de onde vem uma imagem menor que a esperada.',
      },
    ],
  },
  {
    id: '2026-11-14-6',
    title: 'App de desktop 0.7.2',
    items: [
      {
        title: 'App mais firme',
        text: 'A janela não abre mais fora da tela quando você desconecta o segundo monitor, o Windows consegue desligar com o Coreto aberto e o seletor de tela não abre em dobro. O app se atualiza sozinho.',
      },
    ],
  },
  {
    id: '2026-11-14-5',
    title: 'Diagnóstico, transmissão nítida e mais proteção',
    items: [
      {
        title: 'Teste de conexão com um botão',
        text: 'Em Configurações, Diagnóstico, o Coreto testa a sua internet, o servidor, o microfone e as chamadas e diz o que está errado. Dá para copiar o resultado e mandar para quem cuida do Coreto.',
      },
      {
        title: 'Transmissão nítida desde o começo',
        text: 'A tela de quem transmite chegava borrada e levava uns 18 segundos para ficar nítida. Agora ela já começa no tamanho cheio quando a conexão aguenta.',
      },
      {
        title: 'Proteção contra excesso de pedidos',
        text: 'Se alguém (ou um programa) mandar mensagens ou ações rápido demais, o Coreto pede para esperar um instante, e o resto do grupo não sente lentidão. No uso normal, você não nota nada.',
      },
    ],
  },
  {
    id: '2026-11-14-4',
    title: 'Conexão mais firme',
    items: [
      {
        title: 'Conecta mais rápido e avisa melhor',
        text: 'O site agora tenta o WebSocket primeiro, o que evita o erro "xhr poll error" em redes com VPN, antivírus ou proxy. Se mesmo assim a conexão falhar, o aviso diz o que houve e o que conferir.',
      },
      {
        title: 'Arquivos grandes enviam sem falhar',
        text: 'Arquivos grandes agora sobem em pedaços e repetem sozinhos o que cair no caminho. Antes, com internet lenta, um arquivo de 40 MB podia ser cortado no meio.',
      },
    ],
  },
  {
    id: '2026-11-14-3',
    title: 'Voz melhor',
    items: [
      {
        title: 'Voz com mais qualidade',
        text: 'A voz agora é enviada com o dobro da taxa de antes (64 kbps), o que tira o som abafado, de lata, da conversa. Vale na hora, para todo mundo.',
      },
      {
        title: 'Igualar o volume das vozes',
        text: 'Quem fala baixo sobe e quem fala alto desce, só no seu lado, e o som não estoura mesmo com o volume em 200%. Fica em Configurações, Voz e vídeo, e dá para desligar.',
      },
      {
        title: 'Dica da conexão mostra o "pipoca"',
        text: 'Ao passar o mouse nas barrinhas da conexão, agora aparece quanto do áudio precisou ser remendado (o pipoca) e se a conexão passa pelo servidor em vez de ir direto.',
      },
    ],
  },
  {
    id: '2026-11-14-2',
    title: 'Volume das chamadas até 200%',
    items: [
      {
        title: 'Mais volume para ouvir a chamada',
        text: 'Em Configurações, Voz e vídeo, o volume das chamadas agora vai até 200%, como no Discord. Serve para quem ouve baixo no fone ou nas caixas. Acima de 100% pode distorcer se a pessoa já fala alto.',
      },
    ],
  },
  {
    id: '2026-11-14',
    title: 'Estatísticas mostram a captura',
    items: [
      {
        title: 'Quantos quadros a captura entrega',
        text: 'Nas estatísticas de quem transmite aparece "captura N fps (pedido: 60)". Se saem poucos quadros, dá para ver se o limite é o jogo ou a placa de vídeo (captura baixa) ou o envio (captura alta e quadros enviados baixos). Com a captura bem abaixo do pedido, o painel explica o que olhar.',
      },
    ],
  },
  {
    id: '2026-11-12-2',
    title: 'Compartilhar tela mais simples',
    items: [
      {
        title: 'Só o som é perguntado ao compartilhar',
        text: 'A janela de compartilhar tela não pede mais resolução, quadros, prioridade, codificação nem upload: toda transmissão começa na melhor qualidade (1080p, 60 fps, fluida e pela placa de vídeo). Se precisar de menos, o botão de configurações da transmissão continua lá, com ela no ar.',
      },
    ],
  },
  {
    id: '2026-11-12',
    title: 'Transmissão pela placa de vídeo',
    items: [
      {
        title: 'H.264 agora usa a placa de vídeo de verdade',
        text: 'Em muitos computadores, mesmo escolhendo H.264 (placa de vídeo), quem codificava era o processador, e a imagem saía menor e travando. Agora a placa é usada, o que deixa a transmissão mais nítida e fluida, principalmente em jogos. Vale no site e no app, sem precisar atualizar o app.',
      },
      {
        title: 'Aviso mais certo nas estatísticas',
        text: 'Se mesmo assim o processador estiver codificando em H.264, o painel de estatísticas agora diz que a placa não está sendo usada, em vez de mandar escolher H.264 de novo.',
      },
    ],
  },
  {
    id: '2026-11-04',
    title: 'Revisão geral e correções',
    items: [
      {
        title: 'Chamada mais estável',
        text: 'Abrir outro espaço durante uma chamada não faz mais tocar o som de "saiu" para todo mundo, e se a entrada na chamada falhar o microfone é solto na hora (a luz dele não fica acesa).',
      },
      {
        title: 'Menos travadas em diálogos',
        text: 'Se a conexão cair no meio de salvar ou apagar algo (canal, espaço, mensagem), o botão não fica mais preso: aparece o aviso e dá para tentar de novo.',
      },
    ],
  },
  {
    id: '2026-10-30-4',
    title: 'Áudio Democrático',
    items: [
      {
        title: 'O volume da música agora se chama Áudio Democrático',
        text: 'No painel de música, o controle de volume ganhou esse nome: ele muda o volume para todo mundo na chamada. Tudo funciona como antes.',
      },
    ],
  },
  {
    id: '2026-10-30-3',
    title: 'App de desktop 0.7.1',
    items: [
      {
        title: 'Trocar de janela sempre abre o seletor',
        text: 'No app do Windows, trocar a janela transmitida logo depois de começar, com o som desligado, agora sempre mostra o seletor. Atualize o app para usar.',
      },
    ],
  },
  {
    id: '2026-10-30-2',
    title: 'Trocar a janela sem parar a transmissão',
    items: [
      {
        title: 'Trocar a janela ou tela transmitida',
        text: 'Com a transmissão no ar, o botão de trocar (dois quadradinhos) abre o seletor de novo: escolha outra janela ou tela e a transmissão continua, sem cortar para quem está assistindo.',
      },
    ],
  },
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
