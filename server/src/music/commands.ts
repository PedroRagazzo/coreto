// Comandos de chat do bot de música: "/play <link ou busca>", "/skip", "/queue"... São mensagens
// comuns que começam com "/"; o que não for um comando conhecido continua sendo só uma mensagem.

export type CommandName =
  | 'play'
  | 'playnext'
  | 'skip'
  | 'pause'
  | 'resume'
  | 'stop'
  | 'queue'
  | 'now'
  | 'volume'
  | 'clear'
  | 'shuffle'
  | 'help'
  // Só vêm do painel, com o id da música em `args`; não existem como comando de chat.
  | 'remove'
  | 'top';

export interface MusicCommand {
  name: CommandName;
  /** O resto da mensagem depois do comando, sem espaços nas pontas. */
  args: string;
}

const ALIASES: Record<string, CommandName> = {
  play: 'play',
  tocar: 'play',
  p: 'play',
  playnext: 'playnext',
  tocarseguir: 'playnext',
  aseguir: 'playnext',
  pn: 'playnext',
  shuffle: 'shuffle',
  embaralhar: 'shuffle',
  misturar: 'shuffle',
  skip: 'skip',
  pular: 'skip',
  next: 'skip',
  pause: 'pause',
  pausar: 'pause',
  resume: 'resume',
  continuar: 'resume',
  retomar: 'resume',
  stop: 'stop',
  parar: 'stop',
  sair: 'stop',
  queue: 'queue',
  fila: 'queue',
  q: 'queue',
  now: 'now',
  tocando: 'now',
  np: 'now',
  volume: 'volume',
  vol: 'volume',
  clear: 'clear',
  limpar: 'clear',
  help: 'help',
  ajuda: 'help',
};

export function parseCommand(content: string): MusicCommand | null {
  const match = /^\/([\p{L}]{1,12})(?:\s+([\s\S]*))?$/u.exec(content.trim());
  if (!match) return null;
  const name = ALIASES[match[1].toLowerCase()];
  return name ? { name, args: (match[2] ?? '').trim() } : null;
}

export const HELP_TEXT = [
  '**Comandos do Coreto Música** (entre num canal de voz antes):',
  '`/play <link do YouTube ou Spotify, ou o nome da música>`: toca ou entra na fila',
  '`/playnext <link ou busca>`: coloca na frente da fila, para tocar a seguir',
  '`/skip`: pula a música · `/pause` e `/resume`: pausam e continuam',
  '`/queue`: mostra a fila · `/now`: o que está tocando · `/shuffle`: embaralha a fila · `/clear`: esvazia a fila',
  '`/volume <0 a 150>`: volume do bot para todos (100 é o normal) · `/stop`: para tudo e sai da chamada',
].join('\n');
