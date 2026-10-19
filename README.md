# Coreto

[![CI](https://github.com/PedroRagazzo/coreto/actions/workflows/ci.yml/badge.svg)](https://github.com/PedroRagazzo/coreto/actions/workflows/ci.yml)

Plataforma aberta de comunidades com chat em tempo real e salas de voz.
Front-end em React + TypeScript + Tailwind CSS; tempo real em Node.js + socket.io; voz por WebRTC.

**No ar:** https://coreto.2.28.229.48.nip.io · [baixar o app para Windows](https://github.com/PedroRagazzo/coreto/releases/latest)

> [!WARNING]
> **Protótipo: não use em produção.** O login é só nome + PIN de 4 dígitos, todo espaço é
> público, e a voz não foi validada com muitas pessoas ou fora da rede local.
> Veja [Limitações do protótipo](#limitações-do-protótipo).

## Rodando

Requer Node.js 22.12+ e PostgreSQL.

1. Copie `server/.env.example` para `server/.env` e ajuste a `DATABASE_URL` (usuário, senha, porta).
2. Instale as dependências e crie as tabelas:

   ```bash
   npm install
   npm run db:migrate -w server
   ```

   O `db:migrate` cria o banco se ele ainda não existir e aplica as migrations de `server/prisma/migrations`.
3. Rode:

   ```bash
   npm run dev
   ```

Na primeira execução com o banco vazio, o servidor cria os espaços e canais de demonstração.

- Front-end: http://localhost:5173
- Servidor em tempo real: http://localhost:3001 (`/health` responde `{"ok":true}`)

Abra duas janelas (uma anônima) com nomes diferentes para ver mensagens, digitação, presença e voz entre usuários.

| Variável | Onde | Padrão |
|---|---|---|
| `DATABASE_URL` | server (`server/.env`) | obrigatória: conexão PostgreSQL |
| `TEST_DATABASE_URL` | server (`server/.env`) | banco dos testes de integração; nome terminado em `_test` |
| `SERVER_PORT` | server | `3001` |
| `CLIENT_ORIGIN` | server | `http://localhost:5173,http://127.0.0.1:5173` |
| `ICE_SERVERS` | server | STUN público do Google (JSON de `RTCIceServer[]`) |
| `UPLOAD_DIR` | server | `uploads` (pasta das imagens enviadas) |
| `SUPER_ADMIN_NAMES` | server | vazio. Nomes de contas (separados por vírgula) que são **administradoras gerais**: têm todas as permissões em todos os espaços e podem excluir espaços, canais de texto e de voz mesmo sem ser donas. A conta precisa já existir: quem criar o nome primeiro vira administrador |
| `CLIENT_DIST` | server | `../client/dist`: se existir, o servidor também entrega o site |
| `VITE_SERVER_URL` | client | em dev, `http://localhost:3001`; no build, a mesma origem do site |

## Publicar (Docker e Dokploy)

Em produção, um container só entrega o site, a API e o socket.io no mesmo endereço. O `Dockerfile` da raiz gera
a imagem; ao iniciar, ela aplica as migrations (`prisma migrate deploy`) e sobe o servidor na porta 3000. O CI
constrói a imagem e sobe o container contra um PostgreSQL vazio a cada push.

```bash
docker build -t coreto .
docker run -p 3000:3000 -e DATABASE_URL=postgresql://... -v coreto-uploads:/data/uploads coreto
```

No [Dokploy](https://dokploy.com):

1. **Banco:** crie um PostgreSQL no projeto e copie a "Internal Connection URL".
2. **App:** crie uma Application com o provedor Git apontando para este repositório (branch `main`) e build
   type **Dockerfile**.
3. **Variáveis:** `DATABASE_URL` (a URL interna do banco). Para TURN, veja [TURN](#turn).
4. **Volume:** monte um volume em `/data/uploads`, senão as imagens somem a cada deploy.
5. **Domínio:** porta 3000, com HTTPS (Let's Encrypt). Sem domínio próprio, use `coreto.<IP-da-VPS>.nip.io`
   (o Dokploy não ativa HTTPS para sslip.io). **Microfone, câmera e tela só funcionam em HTTPS.**
6. **Deploy.** O primeiro deploy cria as tabelas e os espaços de demonstração.
7. **Deploy automático:** com o Autodeploy ligado, copie a "Webhook URL" da aba Deployments e cadastre-a no
   GitHub (Settings → Webhooks, `application/json`, só o evento push). Cada push na `main` faz um deploy novo.

### TURN no Dokploy

`deploy/coturn/docker-compose.yml` sobe um coturn para as chamadas. No Dokploy, crie um serviço **Compose**
(tipo "Docker Compose", não Stack) apontando para esse arquivo, com `TURN_EXTERNAL_IP` = IP público da VPS.
O compose gera o segredo do TURN na primeira vez num volume com nome fixo, `coreto-turn-secret`. No app, monte
esse volume em `/turn` e defina:

```
TURN_URLS=turn:<IP>:3490?transport=udp,turn:<IP>:3490?transport=tcp
TURN_SECRET_FILE=/turn/turn-secret
```

Assim ninguém precisa copiar o segredo. A VPS precisa aceitar a porta 3490 (UDP e TCP) e a faixa 40000–40199
(UDP). Para conferir de fora, sem o segredo: `node deploy/coturn/check.mjs <IP> 3490` (STUN por UDP e TCP, e
TURN exigindo autenticação). O coturn recusa retransmitir para endereços internos (10.x, 172.16–31.x, 192.168.x,
127.x), para ninguém usar o TURN para alcançar a rede interna da VPS.

### Backup do banco

A imagem traz o `pg_dump` 17. `npm run backup -w server` grava uma cópia compactada em `/data/backups` e guarda as
14 mais recentes (`BACKUP_KEEP`). No Dokploy:

1. monte um volume (por exemplo, `coreto-backups`) em `/data/backups`;
2. crie um agendamento na aba **Schedules** do app com o comando `npm run backup -w server`, uma vez por dia.

As cópias ficam na própria VPS: protegem contra erro humano e banco corrompido, não contra perder a VPS. Para
restaurar, no terminal do app:

```bash
pg_restore --clean --if-exists --no-owner --dbname="$DATABASE_URL" /data/backups/coreto-AAAAMMDD-HHMMSS.dump
```

## App de desktop (Windows)

`desktop/` é um app Electron que abre o servidor de `desktop/coreto.config.json`, como o app do Discord abre o
site. O site roda isolado, sem acesso ao Node. O app só acrescenta quatro coisas:

- um seletor de telas e janelas para compartilhar (o Electron não tem um próprio);
- o som do programa compartilhado, como no Discord (veja abaixo);
- permissão de microfone, câmera e tela só para o servidor configurado;
- links de fora abrindo no navegador padrão.

Se o servidor não responder, aparece uma página para tentar de novo.

**Som da janela e da tela (a partir da 0.5.0):** o Chromium só captura o som do sistema inteiro, e isso inclui a própria chamada (quem
assiste ouviria a conversa de volta). O app leva `desktop/native/coreto-audio.cpp`, um helper de ~200 linhas que usa a
captura de áudio por processo do Windows 10 (a mesma que o Discord usa): ao compartilhar uma **janela** só sai o som do
programa dela; ao compartilhar a **tela inteira** sai tudo menos o próprio Coreto. O helper escreve PCM de 16 bits,
estéreo, 48 kHz; o processo principal repassa à página, que o toca numa faixa de áudio
(`client/src/lib/app-audio.ts` e `client/public/app-audio.worklet.js`) e a junta ao vídeo. Sem o helper (ou fora do
Windows) volta ao som do sistema inteiro na tela inteira. `npm run audio-helper` compila o helper (precisa do Visual
Studio com as ferramentas de C++; o `npm run dist` já faz isso, e o `windows-latest` do GitHub Actions já tem).

**Botão de baixar no site:** a tela de login e Configurações → App de desktop (no navegador) têm o botão
“Baixar para Windows”. Ele aponta para `/download`, que o servidor redireciona para o instalador da última release
(consulta a API do GitHub e guarda o link por 10 minutos; se o GitHub falhar, cai na página de releases). Não precisa
mexer no site a cada versão nova.

```bash
cd desktop
npm install
npm start -- --url=http://localhost:3001   # abre apontando para outro servidor
npm run dist                               # gera release/Coreto-Setup-<versão>.exe
```

Uma tag `v<versão>` (a mesma de `desktop/package.json`) faz o GitHub Actions gerar o instalador e publicar a
release com ele. O instalador não é assinado, então o Windows mostra um aviso na primeira vez.

**Bandeja do Windows** (a partir da 0.3.0): como o Discord, fechar a janela deixa o Coreto rodando na bandeja,
inclusive no meio de uma chamada. Clicar no ícone traz a janela de volta; o botão direito tem "Abrir o Coreto",
"Procurar atualizações" (ou "Reiniciar e atualizar", quando há versão baixada) e "Sair do Coreto". Na primeira vez
um aviso explica onde o app ficou. Dá para desligar em Configurações → App de desktop → "Minimizar para a bandeja ao
fechar". Aberto junto com o Windows, o app começa direto na bandeja.

**Atualização automática** (a partir da 0.2.0): o app instalado consulta o `latest.yml` da última release do GitHub
ao abrir e a cada 4 horas, com o `electron-updater`. Se houver versão nova, baixa em segundo plano e mostra no topo
"A versão X está pronta — Reiniciar agora". Se a pessoa não reiniciar, a versão nova é instalada ao fechar o app. O
site em si não depende disso: ele se atualiza a cada deploy. Para testar sem publicar, sirva uma pasta `release/`
gerada pelo `npm run dist` e rode o app com `CORETO_UPDATE_TEST=<url da pasta>` e um `desktop/dev-app-update.yml`
(`provider: generic`, `url: <a mesma>`), usando no `package.json` uma versão menor que a da pasta.

## Testes

```bash
npm test
```

- **Unitários** (`server/test/unit`): regras de permissão e de nomes. Rodam sempre, sem banco.
- **Integração** (`server/test/integration`): sobem o servidor de verdade numa porta livre e conversam com ele por
  clientes socket.io, cobrindo sessão, presença, mensagens, permissões, conversas diretas, voz, gestão de espaços e
  canais e persistência após reinício. Precisam de `TEST_DATABASE_URL` (em `server/.env` ou no ambiente); sem ela, são
  pulados com um aviso.

Os testes de integração **apagam o banco** a cada arquivo, por isso só aceitam um banco cujo nome termine em `_test`
(por exemplo, `postgresql://postgres:SUA_SENHA@localhost:5432/coreto_test`). As migrations são aplicadas sozinhas.

O CI (`.github/workflows/ci.yml`) roda a cada push e pull request no GitHub Actions, com PostgreSQL 17: checagem de tipos,
todos os testes e o build de produção do client.

## Estrutura

```
coreto/
├── shared/src/              Contrato único entre servidor e cliente
│   ├── models.ts            Espaço, Categoria, Canal, Cargo, Membro, Mensagem, Anexo, Voz
│   ├── markup.ts            Formatação das mensagens e menções (servidor e cliente usam o mesmo parser)
│   ├── search.ts            Texto normalizado da busca (sem acentos, minúsculo)
│   ├── permissions.ts       Bit flags (ler, escrever, conectar, falar...)
│   └── protocol.ts          Eventos socket.io tipados + formatos de sinalização WebRTC
├── Dockerfile               Imagem de produção: site + API + socket.io num container
├── deploy/coturn/           TURN para o Dokploy (compose) e verificador sem segredo (check.mjs)
├── desktop/                 App de desktop (Electron) e instalador do Windows
├── server/
│   ├── prisma/              Esquema (schema.prisma) e migrations do PostgreSQL
│   ├── prisma.config.ts     Configuração do Prisma (lê DATABASE_URL de server/.env)
│   ├── test/                Testes unitários e de integração (Vitest)
│   └── src/
│       ├── index.ts         Processo: banco, dados de demonstração e encerramento
│       ├── app.ts           HTTP (login, anexos) + socket.io + autenticação (startServer)
│       ├── store.ts         Estrutura em memória + leituras e escritas no banco
│       ├── uploads.ts       POST/GET /uploads, pasta dos arquivos e limpeza
│       ├── images.ts        Reconhece PNG/JPEG/GIF/WebP pelo conteúdo e lê as dimensões
│       ├── turn.ts          Servidores ICE e credenciais TURN temporárias
│       ├── static.ts        Entrega o build do site em produção (com política de segurança)
│       ├── db/              Cliente Prisma e conversão linha ↔ modelo de domínio
│       ├── generated/       Cliente gerado pelo `prisma generate` (fora do Git)
│       ├── permissions.ts   Cálculo de permissões efetivas por canal
│       ├── seed.ts          Espaços e canais de demonstração (só com o banco vazio)
│       └── realtime/
│           ├── chat.ts      Entrar no espaço, histórico, busca, mensagens, menções, digitação
│           ├── presence.ts  Online / ausente / não perturbe / indisponível
│           ├── voice.ts     Lista das salas, quem transmite e quem assiste, repasse de sinalização WebRTC
│           ├── membership.ts
│           ├── guards.ts    Validação de payload e permissão
│           └── types.ts     Tipos do socket e nomes das salas
└── client/src/
    ├── state/realtime.tsx   Socket + reducer + ações (fonte única de estado)
    ├── state/selectors.ts
    ├── lib/voice.ts         Malha WebRTC (voz e tela) + medidor de quem está falando
    ├── lib/uploads.ts       Envio de imagens com progresso
    ├── lib/socket.ts, identity.ts, format.ts
    └── components/
        ├── layout/AppShell.tsx   Layout de três colunas
        ├── SpaceRail.tsx         Coluna 1: espaços + mensagens diretas
        ├── ChannelSidebar.tsx    Coluna 2: categorias recolhíveis, # texto e 🔊 voz
        ├── ChatPanel.tsx         Coluna 3: cabeçalho, mensagens, campo de texto
        ├── MemberList.tsx        Membros online / indisponíveis à direita
        ├── MessageContent.tsx    Texto formatado, menções e imagens de uma mensagem
        ├── MentionAutocomplete.tsx  Sugestões ao digitar "@"
        ├── CallView.tsx          Mosaico da chamada: câmeras, avatares e cartões de quem está ao vivo
        ├── StreamStage.tsx       Transmissão de tela no painel central (assistir ou prévia)
        ├── Search.tsx            Caixa de busca do cabeçalho e painel de resultados
        ├── settings/             Configurações: voz e vídeo, sons, atalhos, aparência e app de desktop
        ├── ScreenShareDialog.tsx Qualidade da transmissão antes do seletor do navegador
        ├── VoiceStatusBar.tsx, UserPanel.tsx, MessageList.tsx, MessageInput.tsx ...
```

## Tempo real

Cada aba mantém uma conexão socket.io. Os eventos vão para salas do socket.io:

| Sala | Recebe |
|---|---|
| `space:{id}` | presença, novos membros, lista das salas de voz |
| `channel:{id}` | mensagens e "digitando" (o socket só entra nos canais que pode ler) |
| `voice:{id}` | saída de participantes da chamada |
| `user:{id}` | todas as abas de um usuário: mensagens diretas, menções, "digitando" e presença de quem conversa com ele |

Todo evento do cliente é validado no servidor: tipo do payload, existência do canal e permissão.

## Login

Na primeira vez, a pessoa escolhe um **nome** e um **PIN de 4 dígitos**: se o nome estiver livre, a conta é criada na hora;
se já existir, o PIN precisa bater. Maiúsculas e espaços sobrando não importam ("Ana" e " ana " são a mesma conta).
Depois disso o navegador guarda um token de sessão que **não expira**, e a pessoa fica sempre conectada.

- O login é um `POST /login` no servidor; o socket.io só aceita conexões com um token de sessão válido.
- O banco guarda o hash do PIN (scrypt com sal) e só o hash SHA-256 dos tokens.
- Com só 10 mil PINs possíveis, depois de 5 erros seguidos o nome fica bloqueado por 1 minuto.
- O nome do robô ("Coreto") é reservado.
- Se o servidor não reconhecer mais a sessão guardada (por exemplo, depois de apagar o banco), a tela de login volta sozinha.
- Contas da versão anterior, de antes do PIN, continuam logadas no navegador onde foram criadas.

## Criar, editar e excluir

- **Espaço:** o botão **+** no fim da barra de espaços. Qualquer pessoa pode criar; quem cria vira dono (todas as
  permissões). O espaço nasce com as categorias "Canais de texto" e "Canais de voz", o canal `#geral` e a sala "Geral".
  Como todo espaço é público, todos os usuários viram membros na hora e recebem o espaço pelo evento `space:created`.
- **Editar ou excluir espaço:** a engrenagem no cabeçalho da lista de canais. Renomear exige `ADMINISTRATOR` (o dono tem);
  excluir é só para o dono e pede que o nome do espaço seja digitado para confirmar. A exclusão apaga em cascata cargos,
  categorias, canais, mensagens e membros, desconecta quem estava numa sala de voz do espaço e manda quem estava nele
  para outro espaço. Os espaços de demonstração pertencem ao robô, então ninguém os edita nem exclui.
- **Canal:** o **+** no cabeçalho da lista de canais ou ao lado de cada categoria. Só aparece para quem tem
  `MANAGE_CHANNELS` no espaço (dono, administradores ou cargos com essa permissão), e o servidor confere de novo.
  Nomes de canais de texto são normalizados (`Dúvidas Gerais` → `#dúvidas-gerais`, ver `shared/src/names.ts`).
  Quem está com o espaço aberto recebe o canal pelo evento `channel:created`, com as próprias permissões, e só se puder vê-lo.
- **Editar ou excluir canal:** a engrenagem que aparece ao passar o mouse sobre o canal, com a mesma exigência de
  `MANAGE_CHANNELS`. Dá para mudar nome, tópico (só canais de texto) e categoria; ao mudar de categoria, o canal vai para o
  fim dela. Excluir pede confirmação e apaga também as mensagens do canal (`onDelete: Cascade` no banco). Quem estava
  numa sala de voz excluída é desconectado com um aviso, e quem estava lendo um canal excluído vai para outro canal de texto.

## Histórico e edição de mensagens

- **Histórico completo:** cada canal ou conversa abre com as 50 mensagens mais recentes. Ao rolar até perto do topo, a
  página anterior é buscada (`channel:history` com `before`) e entra em cima sem a leitura pular. A mensagem de
  boas-vindas só aparece quando o histórico chega de fato ao começo.
- **Editar:** só o autor, passando o mouse sobre a mensagem e clicando no lápis. Enter salva, Esc cancela; a mensagem
  ganha "(editada)" para todos (`message:edit` → `message:updated`).
- **Apagar:** o autor apaga as próprias mensagens, com confirmação. Em canais, quem tem `MANAGE_MESSAGES` (o dono do
  espaço, por exemplo) também apaga as dos outros; em conversas diretas, cada um só apaga as suas
  (`message:delete` → `message:deleted`).

## Formatação, menções e imagens

- **Formatação:** `**negrito**`, `*itálico*` ou `_itálico_`, `~~riscado~~`, `` `código` `` e blocos com três crases
  (` ```ts ` na primeira linha indica a linguagem). Links `http(s)://` viram clicáveis; `\*` escreve um asterisco.
  O parser fica em `shared/src/markup.ts` e gera uma árvore, nunca HTML, então não há como injetar marcação.
- **Menções:** digite `@` e parte do nome; escolha com as setas e Enter/Tab (ou o mouse). A mensagem guarda `<@id>`,
  então renomear alguém não quebra menções antigas. Quem é mencionado num canal recebe `mentions:update` em todas as
  abas, mesmo estando em outro espaço: o canal e o espaço ganham um contador vermelho, e a mensagem aparece destacada.
  As menções não vistas ficam no banco (tabela `Mention`) e somem quando a pessoa abre o canal (`mentions:ack`). Só
  conta quem enxerga o canal; o autor, robôs e menções dentro de código ficam de fora. Editar a mensagem tira a menção
  de quem saiu do texto e avisa só quem entrou. Em conversas diretas a menção só destaca o texto.
- **Imagens:** até 4 por mensagem, 8 MB cada, PNG, JPEG, GIF ou WebP. Anexe pelo botão, colando (Ctrl+V) ou
  arrastando para a conversa. Cada imagem sobe na hora para `POST /uploads` (com barra de progresso) e o id vai
  junto no `message:send`. O servidor reconhece o tipo pelo conteúdo (não pela extensão), guarda as dimensões para o
  cliente reservar o espaço antes de a imagem carregar, e serve o arquivo em `GET /uploads/{id}` com `nosniff`.
  Clique numa imagem para ampliar. Apagar a mensagem apaga o arquivo; imagens enviadas e nunca usadas, e arquivos de
  canais ou espaços excluídos, são limpos ao iniciar e a cada hora. Os arquivos ficam em `server/uploads`
  (`UPLOAD_DIR`). O link de uma imagem é aleatório e não exige login, como num CDN: quem tem o link vê a imagem.

## Configurações

A engrenagem ao lado do seu nome, embaixo à esquerda, abre as Configurações em tela cheia (Esc fecha). Tudo fica
guardado no aparelho (`localStorage`), porque o microfone do notebook não é o mesmo do celular.

- **Voz e vídeo:**
  - microfone, saída de áudio (onde o navegador permite escolher) e câmera;
  - volume do microfone (até 200%) e das chamadas;
  - cancelamento de eco, supressão de ruído e controle automático de ganho;
  - **sensibilidade de entrada**, como no Discord: com a detecção automática ligada o microfone fica sempre aberto;
    desligada, só passa o que ultrapassa o nível escolhido (−100 a 0 dB), com a voz fechando devagar para não cortar o
    fim das frases. O teste do microfone mostra o nível em dB com a marca da sensibilidade (a barra fica cinza quando a
    porta está fechada) e permite se ouvir;
  - prévia da câmera.

  Tudo vale **no meio da chamada**. O microfone passa por um circuito de áudio próprio (fonte → ganho → porta de ruído →
  saída fixa): trocar de microfone ou de processamento só troca a fonte, sem renegociar com ninguém. A porta de ruído
  roda numa thread de áudio (`client/public/mic-gate.worklet.js`), então não perde o ritmo com a janela em segundo
  plano. Se o dispositivo escolhido for desconectado, o Coreto usa o padrão do sistema.
- **Volume por pessoa:** botão direito em alguém da sua chamada (na barra lateral ou no mosaico) abre o volume só seu,
  de 0 a 200%, e "Silenciar para mim". Fica guardado por pessoa neste aparelho. A voz recebida passa por um ganho próprio
  antes de tocar, o que permite passar de 100%.
- **Sons:** avisos sintetizados na hora (sem arquivos) quando você entra ou sai da chamada, alguém entra ou sai, alguém
  começa ou para de assistir à transmissão que você faz ou assiste, e quando você muta ou ensurdece. Dá para desligar,
  ajustar o volume e ouvir cada um. Ensurdecido, você não ouve ninguém entrar ou sair. A regra de qual som tocar fica em
  `shared/src/call-sounds.ts`, com testes.
- **Atalhos:** teclas para ativar/desativar o microfone e o som. Clique em Gravar e aperte a tecla ou as teclas juntas
  (até 4), como `V` ou `Shift + V`. Na janela valem para qualquer combinação, mas só durante uma chamada, e uma tecla
  sem Ctrl/Alt/Win não dispara enquanto você digita num campo de texto. **No app de desktop** (a partir da 0.4.0),
  combinações com um modificador e uma tecla comum, como `Ctrl + Shift + M`, valem também com o Coreto em segundo plano
  (`globalShortcut` do Electron); a tela avisa quando outro programa já usa a combinação. Uma tecla sozinha não pode ser
  global: pararia de funcionar em todos os outros programas.
- **Aparência:** tamanho do texto das mensagens (12 a 20 px) e modo compacto (uma linha por mensagem, sem avatar).
- **App de desktop** (só no app): versão, estado da atualização com "Verificar agora" e "Reiniciar e atualizar", e
  "Abrir o Coreto ao ligar o computador". O site fala com o app por uma ponte mínima (`desktop/src/preload.cjs`), e o
  app confere em cada pedido se ele veio do servidor do Coreto.

## Busca

A caixa **Buscar** no cabeçalho procura em todos os canais de texto que você vê no espaço, ou na conversa direta aberta.
Enter abre os resultados à direita, da mensagem mais recente para a mais antiga, com as palavras destacadas. Todas as
palavras precisam aparecer, sem diferenciar acentos nem maiúsculas ("orcamento" encontra "Orçamento"). Os filtros
**De** (autor), **Em** (canal), **Com imagem** e **Com link** funcionam sozinhos ou junto com o texto.

Clicar num resultado abre a conversa já rolada até a mensagem, que pisca por um instante, mesmo que ela seja antiga:
`message:context` traz a mensagem com as vizinhas. A lista fica "parada no passado". Rolar até o fim carrega as
seguintes (`channel:history` com `after`), e o aviso **Ir para as mais recentes** volta ao presente. Mensagens novas
que chegam nesse meio-tempo aparecem ao voltar.

No banco, cada mensagem guarda `searchText`, o conteúdo sem acentos, minúsculo e sem os ids das menções
(`shared/src/search.ts`), com um índice trigram (`pg_trgm`) que acelera a busca por trecho. O servidor só busca nos
canais em que a pessoa tem `VIEW_CHANNEL` e nas conversas diretas de que ela participa.

## Mensagens diretas

Clique em alguém na lista de membros para abrir uma conversa privada. Só é possível conversar com quem participa de
pelo menos um espaço em comum com você, e robôs não recebem mensagens diretas. A conversa só aparece para a outra pessoa
quando a primeira mensagem chega. Ela usa os mesmos eventos dos canais (`channel:history`, `message:send`,
`typing:start`) com o id da conversa no lugar do id do canal; o evento `dm:upsert` avisa sobre conversas novas ou
atualizadas. O ícone de mensagens diretas na barra de espaços mostra quantas mensagens ainda não foram lidas.

## Persistência

O banco é PostgreSQL, acessado pelo Prisma 7 (`@prisma/adapter-pg`). Comandos úteis, rodados a partir da raiz:

| Comando | O que faz |
|---|---|
| `npm run db:migrate -w server` | Cria uma migration a partir de mudanças no `schema.prisma` e aplica (desenvolvimento) |
| `npm run db:deploy -w server` | Só aplica as migrations existentes (produção) |
| `npm run db:studio -w server` | Abre o Prisma Studio para ver e editar os dados |

O que vai para o banco: usuários, sessões (só o hash SHA-256 do token), espaços, cargos, categorias, canais, sobrescritas
de permissão, membros, conversas diretas, mensagens, menções não vistas e os dados dos anexos (os arquivos ficam em disco). Presença e estado das salas de voz são efêmeros e ficam só em memória.

Ao iniciar, o servidor carrega a estrutura (tudo menos as mensagens) para a memória, porque as permissões são checadas a
cada evento. Toda escrita vai primeiro ao banco e depois atualiza a memória. As mensagens nunca ficam em memória: são
gravadas e paginadas direto no banco. Isso funciona com **uma instância** do servidor; para rodar várias, a memória de
cada uma precisaria ser invalidada (por exemplo, com Redis pub/sub) e o socket.io precisaria de um adaptador compartilhado.

## Permissões

`Role.permissions` é um bitfield (`shared/src/permissions.ts`). Cada canal tem `overwrites` com `allow`/`deny` para um cargo ou membro.
O cálculo (`server/src/permissions.ts`) aplica, em ordem: dono do espaço → cargos (+ `@everyone`) → `ADMINISTRATOR` →
sobrescrita de `@everyone` → sobrescritas dos cargos → sobrescrita do membro. Sem `VIEW_CHANNEL` o canal some.

`STREAM` (vídeo: câmera e tela) vem ligada no `@everyone`; uma sobrescrita de canal pode tirá-la de uma sala.

Exemplos na seed: `#avisos` (todos leem, só a Moderação escreve) e `#moderação` (invisível para quem não é da Moderação).

## Voz

Um clique entra na sala; outro em "Sair da chamada" sai. O servidor guarda quem está em cada sala e só repassa a sinalização
(SDP e candidatos ICE) entre participantes da mesma sala. O áudio vai direto entre os navegadores (malha P2P).

Microfone e som desativados aparecem para todos ao lado do nome, na lista da sala. Quem está na chamada vê um anel
verde em quem está falando: cada navegador mede o volume do áudio que recebe (e do próprio microfone), sem passar
nada pelo servidor.

A malha funciona bem até umas 5 a 8 pessoas por sala, porque cada participante envia o áudio para todos os outros.
Para salas maiores, e para impor `SPEAK` no servidor, troque por um SFU (mediasoup, LiveKit ou Janus):
o protocolo de `voice:join` / `voice:signal` já isola essa troca em `server/src/realtime/voice.ts` e `client/src/lib/voice.ts`.

### Câmera e visão da chamada

Como no Discord, a barra de voz tem os botões **Câmera** e **Tela** lado a lado. Clicar no canal de voz (para entrar,
ou de novo depois de entrar) abre a **visão da chamada** no painel central. Ela mostra um quadro por pessoa: a câmera
de quem ligou, ou o avatar, com o anel verde de quem está falando. Também traz um cartão para cada tela ao vivo, com
**Assistir**, e controles de câmera, tela, microfone e sair. Sua câmera aparece espelhada para você e normal para os
outros.

A câmera vai para todos da chamada em 640×360 (até 600 kbit/s por pessoa), para caber na malha. O servidor só guarda
`video` de cada participante (`voice:video`). Câmera e tela viajam em fluxos fixos; ao abrir cada conexão, os dois lados
anunciam os ids deles (sinal `media`), e é assim que quem recebe sabe qual vídeo é qual. Ligar a câmera usa a mesma
permissão `STREAM` da tela, como a permissão "Vídeo" do Discord.

### Compartilhamento de tela

Funciona como o "Go Live" do Discord. Dentro de uma sala de voz, **Compartilhar tela** abre a escolha de qualidade
(720p, 1080p ou original; 15, 30 ou 60 fps; com ou sem som). Depois disso, o próprio navegador pergunta qual tela,
janela ou aba compartilhar. Quem transmite ganha o selo **AO VIVO** na lista da sala; os outros clicam no nome para
assistir, o que também os coloca na chamada se ainda não estiverem nela. A transmissão abre no painel central com
quantas pessoas estão assistindo (e quem, ao passar o mouse), volume do som da tela e tela cheia. Quem transmite vê uma
prévia sem som e o contador "N assistindo" na barra de voz. Parar pelo botão do Coreto, pelo aviso do navegador ou
saindo da chamada mostra "A transmissão terminou" para quem assistia.

O vídeo só vai para quem escolheu assistir, o que economiza a banda de quem transmite. O servidor só guarda
`streaming` e `watching` de cada participante (`stream:start`, `stream:stop`, `stream:watch`, `stream:unwatch`) e quem
transmite lê essa lista. Cada pessoa que assiste ganha um transceptor de vídeo na conexão direta (uma renegociação na
primeira vez); depois, parar e voltar a assistir só troca a faixa (`replaceTrack`), sem renegociar. Como qualquer lado
pode renegociar, `client/src/lib/voice.ts` usa o padrão "perfect negotiation" do WebRTC para resolver ofertas
simultâneas. A permissão `STREAM` controla quem pode transmitir; o `@everyone` a tem por padrão.

**Qualidade com vários espectadores.** Na malha P2P cada espectador recebe uma cópia do vídeo, e o computador de quem
transmite codifica uma vez por espectador. Para a imagem não ficar borrada quando a internet aperta:

- **Prioridade** (Nitidez ou Fluidez): Nitidez usa `contentHint = 'text'`, que mantém a resolução e deixa os quadros
  caírem; Fluidez usa `'motion'`, que faz o contrário. O padrão é Nitidez, porque a maior parte das telas é texto.
- **Upload da sua internet** (5, 10, 20 ou 50 Mbps): 70% dele é dividido entre quem assiste, e o limite de cada
  espectador cai com o número de pessoas. Se o bitrate não dá para a resolução, a imagem é reduzida
  (`scaleResolutionDownBy`) em vez de ficar cheia de blocos. As contas ficam em `shared/src/stream-quality.ts`, com testes.
- **Estatísticas** (botão com o ícone de atividade no cabeçalho da transmissão): resolução, quadros por segundo, bitrate,
  codec, perda de pacotes e latência, lidos de `getStats()`. Para quem transmite mostra também o que está limitando a
  qualidade (seu computador ou sua internet).

Para transmitir bem para muita gente de uma vez, o caminho é um servidor de mídia (SFU): quem transmite envia uma cópia só.

### TURN

Na mesma rede, ou com NATs simples, o STUN basta. Atrás de NAT simétrico, 4G ou firewall corporativo, o áudio só passa
por um servidor TURN. Com o [coturn](https://github.com/coturn/coturn) em modo `use-auth-secret`, o Coreto gera para
cada pessoa uma credencial temporária (o padrão "TURN REST API"), e o segredo nunca chega ao navegador:

```
# turnserver.conf
use-auth-secret
static-auth-secret=um-segredo-longo
realm=turn.exemplo.com
```

```
# server/.env
TURN_URLS="turn:turn.exemplo.com:3478,turns:turn.exemplo.com:5349"
TURN_SECRET="um-segredo-longo"
```

Para conferir se o TURN funciona, defina também `ICE_TRANSPORT_POLICY="relay"`: todo o áudio passa a ir pelo TURN, e
se a chamada ficar muda o problema está nele (porta, segredo ou realm). Servidores fixos continuam aceitos em
`ICE_SERVERS` (JSON). Veja `server/.env.example`.

## Limitações do protótipo

- Login fraco de propósito: nome + PIN de 4 dígitos, sessões que nunca expiram e sem botão de sair.
- Não há como trocar o ícone do espaço, transferir a posse, reordenar canais, criar categorias, nem criar ou atribuir
  cargos pela interface.
- Todo espaço é público: quem conecta vira membro de todos, inclusive dos criados por outras pessoas.
- Mensagens diretas só entre duas pessoas (sem grupos) e sem lista para buscar usuários: comece pela lista de membros.
- Mensagens não lidas só são contadas nas conversas diretas, e a contagem zera ao recarregar a página. Menções, ao
  contrário, ficam guardadas até serem vistas.
- Anexos só de imagem, sem limite de envios por pessoa, guardados no disco do servidor (para várias instâncias, troque
  por um armazenamento de objetos como S3).
- O anel de quem está falando só aparece para quem está na mesma chamada.
- Na malha P2P, cada câmera vai para todos da chamada e cada tela vai para cada pessoa que assiste. Com vídeo, a
  chamada aguenta umas 4 ou 5 pessoas, conforme a internet de cada uma. Cada pessoa assiste a uma transmissão por vez.
- A busca compara trechos de palavras (sem português "inteligente": "correr" não encontra "corri"). Com milhões de
  mensagens, troque por busca de texto completo (`tsvector`) ou um serviço de busca.

## Licença

[MIT](LICENSE)
