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
    id: '2026-11-20-5',
    title: 'Chamada mais firme no celular',
    items: [
      {
        title: 'A tela não apaga na chamada',
        text: 'No celular ou tablet, enquanto você está numa chamada a tela fica ligada. Se você sair do Coreto para outro app, ela volta a ficar ligada quando você retornar.',
      },
      {
        title: 'Controles na tela de bloqueio',
        text: 'A tela de bloqueio e as notificações do celular mostram "Coreto — em chamada", com botões para sair e para mutar o microfone. Com a tela bloqueada, o navegador pode cortar o seu microfone: depende do aparelho.',
      },
      {
        title: 'Por que a conexão caiu',
        text: 'Em Configurações, Diagnóstico, agora há a lista das últimas quedas de conexão deste aparelho, com o motivo e em quanto tempo voltou. Se você cai da chamada do nada, copie e mande para quem está ajudando.',
      },
    ],
  },
  {
    id: '2026-11-20-4',
    title: 'O Coreto no celular',
    items: [
      {
        title: 'Cabe na tela do celular',
        text: 'Abra o Coreto no navegador do celular: agora ele cabe na tela, com a lista de canais, a conversa e a chamada em telas separadas. Use a seta no alto da conversa para voltar à lista.',
      },
      {
        title: 'Feito para o toque',
        text: 'As ações das mensagens ficam sempre à vista, e segurar o dedo numa pessoa da chamada abre o volume só seu. Busca, mensagens fixadas, membros e configurações ocupam a tela inteira.',
      },
    ],
  },
  {
    id: '2026-11-20-3',
    title: 'A transmissão volta sozinha',
    items: [
      {
        title: 'No app de desktop',
        text: 'Depois de uma atualização ou queda, quem transmite pelo app volta ao ar sozinho, com a mesma tela ou janela e a mesma qualidade. No navegador continua o botão Retomar transmissão.',
      },
    ],
  },
  {
    id: '2026-11-20-2',
    title: 'Som das transmissões bem mais alto',
    items: [
      {
        title: 'Volume acima de 100% de verdade',
        text: 'Na barrinha de volume da tela de alguém, passar de 100% agora também sobe o som que chega baixo, e quanto mais alto, mais forte. Ao voltar para 100% ou menos, o som fica como chegou.',
      },
    ],
  },
  {
    id: '2026-11-20',
    title: 'Atualizações sem perder a chamada',
    items: [
      {
        title: 'O Coreto se atualiza sozinho',
        text: 'Quando sai uma versão nova, a página recarrega sozinha. Se você estava em uma chamada, volta para ela na hora, com o microfone como estava.',
      },
      {
        title: 'F5 e Ctrl+F5 também voltam à chamada',
        text: 'Recarregar a página no meio de uma chamada não tira mais você dela: você volta para a mesma sala. Se estava transmitindo a tela, aparece o botão Retomar transmissão.',
      },
    ],
  },
  {
    id: '2026-11-17-3',
    title: 'Som das transmissões mais alto',
    items: [
      {
        title: 'Volume até 300%',
        text: 'Ao assistir a tela de alguém, a barrinha de volume agora vai além de 100%, até 300%, e mostra a porcentagem. Dá para aumentar bastante o som sem ele estourar.',
      },
    ],
  },
  {
    id: '2026-11-17-2',
    title: 'Retomar a transmissão',
    items: [
      {
        title: 'Um clique para voltar ao ar',
        text: 'Se a conexão cair enquanto você transmite a tela, a chamada volta sozinha e aparece o botão Retomar transmissão, que usa as mesmas escolhas de qualidade de antes.',
      },
    ],
  },
  {
    id: '2026-11-17',
    title: 'A chamada volta sozinha',
    items: [
      {
        title: 'Atualizações não derrubam mais a chamada',
        text: 'Se a conexão cair no meio de uma chamada (numa atualização do Coreto, por exemplo), você volta sozinho para a sala assim que ela voltar, com o microfone e o som como estavam. Só a transmissão de tela precisa ser retomada à mão.',
      },
    ],
  },
  {
    id: '2026-11-16-3',
    title: 'Novo endereço do Coreto',
    items: [
      {
        title: 'coreto.hubdev.app',
        text: 'O Coreto mudou de endereço: agora é https://coreto.hubdev.app. O app do Windows 0.7.5 já abre o endereço novo; quem usa o app antigo precisa baixar a versão nova.',
      },
    ],
  },
  {
    id: '2026-11-16-2',
    title: 'Pequenos acertos',
    items: [
      {
        title: 'O texto que você digitou fica guardado',
        text: 'Ao abrir uma transmissão ou a chamada no meio de uma mensagem, o que você já tinha escrito continua lá quando voltar para a conversa. Cada canal e cada conversa guarda o seu rascunho.',
      },
      {
        title: 'Menções não gastam o limite da mensagem',
        text: 'Marcar alguém com @ agora conta só o que você digitou. Antes, cada menção pesava uns 40 caracteres no limite de 2000 e a mensagem podia ser recusada sem motivo aparente.',
      },
      {
        title: 'Envio de arquivos com o servidor cheio',
        text: 'Se vários arquivos sobem ao mesmo tempo, o servidor reserva o espaço de cada um antes de receber. Assim ninguém envia um arquivo grande até o fim só para ouvir que não coube.',
      },
    ],
  },
  {
    id: '2026-11-16',
    title: 'Visual novo, em azul',
    items: [
      {
        title: 'Cores e painéis',
        text: 'O Coreto trocou o verde por uma paleta azul e agora os painéis (espaços, canais e conversa) flutuam com cantos arredondados sobre um fundo azulado.',
      },
      {
        title: 'Botões da chamada acima do seu nome',
        text: 'Microfone, som, câmera e tela ficam em quatro botões redondos logo acima do seu nome, com Música, Sons e Sair embaixo deles. A música que está tocando aparece num cartão azul logo acima.',
      },
    ],
  },
  {
    id: '2026-11-15-6',
    title: 'Volume de cada som do quadro de som',
    items: [
      {
        title: 'Cada som no seu volume',
        text: 'No quadro de som, o ícone de alto-falante de cada som deixa você acertar o volume dele, de 10% a 200%, e ouvir o resultado na hora. Serve para o som que estoura ou o que mal se escuta. Vale só no seu aparelho.',
      },
    ],
  },
  {
    id: '2026-11-15-5',
    title: 'Música: repetir, avançar no tempo e votar para pular',
    items: [
      {
        title: 'Repetir',
        text: 'No painel de música, o botão de repetir alterna entre repetir a música que toca e repetir a fila inteira. No chat, use /repeat.',
      },
      {
        title: 'Ir a um ponto da música',
        text: 'Clique na barra de progresso, ou use os botões de voltar e avançar 10 segundos. No chat, use /seek 1:30 (ou /seek +30 e /seek -15).',
      },
      {
        title: 'Votar para pular',
        text: 'Com mais de duas pessoas na sala, pular passa a ser uma votação: é preciso a metade da sala mais um. Quem pediu a música pula direto. Com duas pessoas ou menos, nada muda.',
      },
    ],
  },
  {
    id: '2026-11-15-4',
    title: 'App de desktop 0.7.3',
    items: [
      {
        title: 'Atalhos dos sons no jogo',
        text: 'Os atalhos que você der aos sons do quadro de som agora também funcionam com o Coreto em segundo plano e com um jogo em tela cheia, como os de mutar. O app se atualiza sozinho.',
      },
    ],
  },
  {
    id: '2026-11-15-3',
    title: 'Atalhos para os sons do quadro de som',
    items: [
      {
        title: 'Um atalho para cada som',
        text: 'No quadro de som, passe o mouse num som e clique no ícone de teclado para dar um atalho a ele (como V ou Shift + V). Na chamada, apertar a tecla toca o som sem abrir o quadro. O atalho é só do seu aparelho.',
      },
      {
        title: 'No app de desktop, até no jogo',
        text: 'Depois de atualizar o app de desktop, os atalhos dos sons também funcionam com o Coreto em segundo plano e com um jogo em tela cheia, como os de mutar.',
      },
    ],
  },
  {
    id: '2026-11-15-2',
    title: 'Canais que guardam os arquivos para sempre',
    items: [
      {
        title: 'Fotos e arquivos que não somem',
        text: 'Quem gerencia canais pode ligar "Guardar os arquivos e fotos para sempre" em Editar canal. Nesse canal, os anexos não são apagados depois de 20 dias, como nos outros.',
      },
    ],
  },
  {
    id: '2026-11-15',
    title: 'Sons longos no quadro de som',
    items: [
      {
        title: 'Sem limite de duração',
        text: 'O quadro de som deixou de limitar o som a poucos segundos: agora aceita qualquer duração, até 10 MB por arquivo (uns 10 minutos de MP3). Para cortar um som longo no meio, use o botão Parar.',
      },
    ],
  },
  {
    id: '2026-11-14-12',
    title: 'Mais escolhas ao compartilhar a tela',
    items: [
      {
        title: 'Resolução Original, quadros por segundo e placa de vídeo',
        text: 'Ao compartilhar a tela, você agora escolhe a resolução (720p, 1080p, 2K ou Original, a recomendada: do tamanho da sua tela), os quadros por segundo (15, 30 ou 60) e se quem codifica é a placa de vídeo ou o processador.',
      },
      {
        title: 'No ar, só trocar a tela',
        text: 'Com a transmissão no ar, o botão de configurações saiu: sobrou o de trocar a janela ou a tela. Para mudar a qualidade, pare e comece de novo, que o diálogo já vem com a sua última escolha.',
      },
    ],
  },
  {
    id: '2026-11-14-11',
    title: 'A resolução escolhida agora vale',
    items: [
      {
        title: '1080p sai em 1080p',
        text: 'Em alguns computadores a tela escolhida em 1080p chegava menor (1080×608), e só a opção "Original" saía no tamanho certo. Agora o Coreto pede a largura e a altura juntas, e o 720p, 1080p e 2K saem no tamanho escolhido.',
      },
    ],
  },
  {
    id: '2026-11-14-10',
    title: 'Placa de vídeo conferida de verdade',
    items: [
      {
        title: '2K pela placa de vídeo sai a 30 quadros',
        text: 'No navegador, a placa de vídeo só codifica o 2K a 30 quadros por segundo; a 60, o processador assume. Ao escolher 2K com a placa de vídeo, o Coreto agora transmite a 30 fps e avisa isso, para a placa de fato trabalhar. Para 60 fps pela placa, use 1080p.',
      },
      {
        title: 'Diagnóstico acerta a placa de vídeo',
        text: 'O teste do Diagnóstico dizia que a placa de vídeo não codificava H.264 mesmo quando ela codificava. Agora ele pergunta do jeito certo. O painel de estatísticas também mostra se a captura é da tela inteira ou de uma janela.',
      },
    ],
  },
  {
    id: '2026-11-14-9',
    title: 'Placa de vídeo ou processador',
    items: [
      {
        title: 'Escolha quem codifica a transmissão',
        text: 'Ao compartilhar a tela, agora dá para escolher entre Placa de vídeo (deixa o processador livre para o jogo) e Processador. O Coreto confere antes se o seu computador usa a placa e avisa na hora se ela não for usada.',
      },
    ],
  },
  {
    id: '2026-11-14-8',
    title: 'Escolha a resolução da transmissão',
    items: [
      {
        title: '720p, 1080p ou 2K',
        text: 'Ao compartilhar a tela, agora há uma escolha só antes de começar: 720p, 1080p ou 2K. O Coreto lembra a sua última escolha, e o resto da qualidade já sai no melhor. O 2K pede boa internet e uma placa de vídeo forte.',
      },
    ],
  },
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
