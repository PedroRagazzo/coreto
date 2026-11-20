# App de celular do Coreto — design

Data: 2026-11-20. Status: aguardando aprovação.

## Intenção e o porquê

O dono quer **ficar em call com a tela do celular bloqueada** (ou com outro app em primeiro plano), no **Android e no iPhone**. O Coreto já tem
site, app de desktop (Electron) e chamada por voz; o que falta no celular é isso: hoje o navegador (e um site instalado como app) corta o
microfone quando a tela bloqueia. Só um app com permissão do sistema para segundo plano resolve.

## Objetivos

1. O Coreto usável numa tela pequena (layout de celular), no navegador e dentro do app.
2. Um app de Android que mantém a call (microfone e som, nos dois sentidos) com a tela bloqueada.
3. Depois, o mesmo no iPhone.
4. Um só código do Coreto (o mesmo site), como o app de desktop já faz.

## Não objetivos

- Transmitir a tela do celular (os navegadores móveis não oferecem; fica fora).
- Reescrever o Coreto em código nativo (React Native, Flutter, Swift/Kotlin).
- Publicar nas lojas públicas agora (Play Store e App Store). Distribuição entre amigos.
- Notificação com o app fechado (push) nesta etapa; fica como trabalho futuro, depois de a call funcionar.

## Contra-objetivos (seria fracasso mesmo "funcionando")

- A call cair em poucos minutos com a tela bloqueada, ou o celular esquentar e gastar a bateria sem controle.
- Um site para computador e outro para celular que precisam ser mantidos em separado.

## Restrições

- Mesmo servidor, mesmo protocolo e mesmo site (`https://coreto.hubdev.app`); o app abre o site, como o desktop (`desktop/coreto.config.json`).
- O servidor e o deploy continuam como estão (Dokploy, de outra pessoa); nada no servidor muda sem pedir.
- iPhone: instalar em aparelhos de amigos exige a conta Apple Developer Program (cerca de US$ 99 por ano) e distribuição por TestFlight.
  Sem ela, só aparelhos de teste, por poucos dias. A compilação roda em Mac virtual do GitHub Actions (o repositório é público).
- Android: o arquivo de instalação (APK) pode ser gerado no GitHub Actions e baixado das releases; sem conta paga.

## Abordagens consideradas

- **A. Casca (Capacitor) que abre o site, Android e iPhone — escolhida.** Um código só. Para a call ficar no ar com a tela bloqueada, a casca
  usa permissões do sistema (Android: serviço em primeiro plano do tipo microfone; iPhone: modo de áudio em segundo plano). Risco: a tela web
  dentro da casca pode pausar o microfone mesmo assim; por isso há um teste logo no começo (fase 2).
- **B. A casca da A com a voz refeita em código nativo (aparece como ligação para o sistema).** Mais confiável com a tela bloqueada, muito mais
  trabalho (a voz entre pessoas teria de ser reescrita em Android e iPhone). Plano de reserva: só se o teste da fase 2 falhar.
- **C. App 100% nativo.** Praticamente refazer o Coreto duas vezes. Descartada.
- **Só o site instalado (PWA).** Não segura o microfone com a tela bloqueada. Descartada (mas o layout de celular da fase 1 serve a ele também).

## Fases (ordem decidida pelo dono)

1. **Layout de celular.** Em telas estreitas, uma coisa por vez (espaços, canais, conversa, membros) com navegação embaixo, e a call/transmissão
   para caber. Vale para o navegador de celular e para o app. Testado nos testes de navegador com janela de celular.
2. **Casca Android e o teste da call.** Projeto Capacitor em `mobile/` apontando para o site, serviço em primeiro plano durante a call (aviso
   fixo "Coreto — em chamada" com botão de sair), APK gerado no GitHub Actions. **Critério de sucesso:** call de 10 minutos com a tela bloqueada,
   microfone e som funcionando nos dois sentidos, voltando bem ao trocar entre Wi-Fi e dados e ao receber uma ligação. Se falhar, decidir pela B.
3. **iPhone.** Mesma casca, modo de áudio em segundo plano, compilação em Mac virtual, distribuição por TestFlight (depende da conta Apple).

## O que ficou por conta de quem for construir

Escolha do plugin de serviço em primeiro plano e de áudio; saída de som (fone, viva-voz, Bluetooth); permissões pedidas na primeira chamada; ícone
e nome; como o APK é atualizado (início: baixar da release; depois, aviso dentro do app); ajustes do cancelamento de ruído no celular.

## Decisões minhas (para o dono conferir)

- Pasta `mobile/` na raiz, no mesmo repositório, com versão e releases próprias (tag `mobile-vX.Y.Z`), separadas da tag do desktop.
- Layout de celular abaixo de 768 px, com a mesma identidade visual do site; sem o painel de membros fixo (vira uma tela).
- Sem notificações push nesta etapa; a notificação do site continua como está.
