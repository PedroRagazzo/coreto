# Coreto

Plataforma aberta de comunidades com chat em tempo real e salas de voz.
Front-end em React + TypeScript + Tailwind CSS; tempo real em Node.js + socket.io; voz por WebRTC.

> [!WARNING]
> **Protótipo: não use em produção.** O login não tem senha (qualquer um escolhe um nome e entra), todo espaço é
> público, e a voz não foi validada com muitas pessoas ou fora da rede local.
> Veja [Limitações do protótipo](#limitações-do-protótipo).

## Rodando

Requer Node.js 20.19+ e PostgreSQL.

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
| `SERVER_PORT` | server | `3001` |
| `CLIENT_ORIGIN` | server | `http://localhost:5173,http://127.0.0.1:5173` |
| `ICE_SERVERS` | server | STUN público do Google (JSON de `RTCIceServer[]`) |
| `VITE_SERVER_URL` | client | `http://localhost:3001` |

## Estrutura

```
coreto/
├── shared/src/              Contrato único entre servidor e cliente
│   ├── models.ts            Espaço, Categoria, Canal, Cargo, Membro, Mensagem, Voz
│   ├── permissions.ts       Bit flags (ler, escrever, conectar, falar...)
│   └── protocol.ts          Eventos socket.io tipados + formatos de sinalização WebRTC
├── server/
│   ├── prisma/              Esquema (schema.prisma) e migrations do PostgreSQL
│   ├── prisma.config.ts     Configuração do Prisma (lê DATABASE_URL de server/.env)
│   └── src/
│       ├── index.ts         HTTP + socket.io + autenticação provisória
│       ├── store.ts         Estrutura em memória + leituras e escritas no banco
│       ├── db/              Cliente Prisma e conversão linha ↔ modelo de domínio
│       ├── generated/       Cliente gerado pelo `prisma generate` (fora do Git)
│       ├── permissions.ts   Cálculo de permissões efetivas por canal
│       ├── seed.ts          Espaços e canais de demonstração (só com o banco vazio)
│       └── realtime/
│           ├── chat.ts      Entrar no espaço, histórico, mensagens, digitação
│           ├── presence.ts  Online / ausente / não perturbe / indisponível
│           ├── voice.ts     Lista das salas + repasse de sinalização WebRTC
│           ├── membership.ts
│           ├── guards.ts    Validação de payload e permissão
│           └── types.ts     Tipos do socket e nomes das salas
└── client/src/
    ├── state/realtime.tsx   Socket + reducer + ações (fonte única de estado)
    ├── state/selectors.ts
    ├── lib/voice.ts         Malha WebRTC (uma RTCPeerConnection por participante)
    ├── lib/socket.ts, identity.ts, format.ts
    └── components/
        ├── layout/AppShell.tsx   Layout de três colunas
        ├── SpaceRail.tsx         Coluna 1: espaços + mensagens diretas
        ├── ChannelSidebar.tsx    Coluna 2: categorias recolhíveis, # texto e 🔊 voz
        ├── ChatPanel.tsx         Coluna 3: cabeçalho, mensagens, campo de texto
        ├── MemberList.tsx        Membros online / indisponíveis à direita
        ├── VoiceStatusBar.tsx, UserPanel.tsx, MessageList.tsx, MessageInput.tsx ...
```

## Tempo real

Cada aba mantém uma conexão socket.io. Os eventos vão para salas do socket.io:

| Sala | Recebe |
|---|---|
| `space:{id}` | presença, novos membros, lista das salas de voz |
| `channel:{id}` | mensagens e "digitando" (o socket só entra nos canais que pode ler) |
| `voice:{id}` | saída de participantes da chamada |
| `user:{id}` | todas as abas de um usuário: mensagens diretas, "digitando" e presença de quem conversa com ele |

Todo evento do cliente é validado no servidor: tipo do payload, existência do canal e permissão.

## Criar espaços e canais

- **Espaço:** o botão **+** no fim da barra de espaços. Qualquer pessoa pode criar; quem cria vira dono (todas as
  permissões). O espaço nasce com as categorias "Canais de texto" e "Canais de voz", o canal `#geral` e a sala "Geral".
  Como todo espaço é público, todos os usuários viram membros na hora e recebem o espaço pelo evento `space:created`.
- **Canal:** o **+** no cabeçalho da lista de canais ou ao lado de cada categoria. Só aparece para quem tem
  `MANAGE_CHANNELS` no espaço (dono, administradores ou cargos com essa permissão), e o servidor confere de novo.
  Nomes de canais de texto são normalizados (`Dúvidas Gerais` → `#dúvidas-gerais`, ver `shared/src/names.ts`).
  Quem está com o espaço aberto recebe o canal pelo evento `channel:created`, com as próprias permissões, e só se puder vê-lo.

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
de permissão, membros, conversas diretas e mensagens. Presença e estado das salas de voz são efêmeros e ficam só em memória.

Ao iniciar, o servidor carrega a estrutura (tudo menos as mensagens) para a memória, porque as permissões são checadas a
cada evento. Toda escrita vai primeiro ao banco e depois atualiza a memória. As mensagens nunca ficam em memória: são
gravadas e paginadas direto no banco. Isso funciona com **uma instância** do servidor; para rodar várias, a memória de
cada uma precisaria ser invalidada (por exemplo, com Redis pub/sub) e o socket.io precisaria de um adaptador compartilhado.

## Permissões

`Role.permissions` é um bitfield (`shared/src/permissions.ts`). Cada canal tem `overwrites` com `allow`/`deny` para um cargo ou membro.
O cálculo (`server/src/permissions.ts`) aplica, em ordem: dono do espaço → cargos (+ `@everyone`) → `ADMINISTRATOR` →
sobrescrita de `@everyone` → sobrescritas dos cargos → sobrescrita do membro. Sem `VIEW_CHANNEL` o canal some.

Exemplos na seed: `#avisos` (todos leem, só a Moderação escreve) e `#moderação` (invisível para quem não é da Moderação).

## Voz

Um clique entra na sala; outro em "Sair da chamada" sai. O servidor guarda quem está em cada sala e só repassa a sinalização
(SDP e candidatos ICE) entre participantes da mesma sala. O áudio vai direto entre os navegadores (malha P2P).

A malha funciona bem até umas 5 a 8 pessoas por sala, porque cada participante envia o áudio para todos os outros.
Para salas maiores, e para impor `SPEAK` no servidor, troque por um SFU (mediasoup, LiveKit ou Janus):
o protocolo de `voice:join` / `voice:signal` já isola essa troca em `server/src/realtime/voice.ts` e `client/src/lib/voice.ts`.
Fora de redes locais, configure um servidor TURN em `ICE_SERVERS`.

## Limitações do protótipo

- Login provisório: token aleatório no `localStorage`, sem senha.
- Não há como editar ou apagar espaços e canais, criar categorias, nem criar ou atribuir cargos pela interface.
- Todo espaço é público: quem conecta vira membro de todos, inclusive dos criados por outras pessoas.
- Mensagens diretas só entre duas pessoas (sem grupos) e sem lista para buscar usuários: comece pela lista de membros.
- Mensagens não lidas só são contadas nas conversas diretas, e a contagem zera ao recarregar a página.
- Sem edição/remoção de mensagens, anexos, vídeo, compartilhamento de tela ou indicador de quem está falando.

## Licença

[MIT](LICENSE)
