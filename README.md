# Coreto

Plataforma aberta de comunidades com chat em tempo real e salas de voz.
Front-end em React + TypeScript + Tailwind CSS; tempo real em Node.js + socket.io; voz por WebRTC.

> [!WARNING]
> **Protótipo: não use em produção.** O login não tem senha (qualquer um escolhe um nome e entra), os dados ficam
> só em memória e somem quando o servidor reinicia, e a voz não foi validada com muitas pessoas ou fora da rede local.
> Veja [Limitações do protótipo](#limitações-do-protótipo).

## Rodando

```bash
npm install
npm run dev
```

- Front-end: http://localhost:5173
- Servidor em tempo real: http://localhost:3001 (`/health` responde `{"ok":true}`)

Abra duas janelas (uma anônima) com nomes diferentes para ver mensagens, digitação, presença e voz entre usuários.

| Variável | Onde | Padrão |
|---|---|---|
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
│   ├── prisma/schema.prisma Esquema relacional (PostgreSQL) para a fase com banco
│   └── src/
│       ├── index.ts         HTTP + socket.io + autenticação provisória
│       ├── store.ts         Armazenamento em memória (troque por repositório com banco)
│       ├── permissions.ts   Cálculo de permissões efetivas por canal
│       ├── seed.ts          Espaços e canais de demonstração
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

Todo evento do cliente é validado no servidor: tipo do payload, existência do canal e permissão.

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
- Dados em memória: reiniciar o servidor apaga tudo. O esquema Prisma está pronto, mas não está ligado.
- Mensagens diretas: só o lugar no layout.
- Sem edição/remoção de mensagens, anexos, vídeo, compartilhamento de tela ou indicador de quem está falando.
- Todos os espaços são públicos: quem conecta vira membro de todos.

## Licença

[MIT](LICENSE)
