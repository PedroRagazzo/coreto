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
  | 'repeat'
  | 'seek'
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
  voteskip: 'skip',
  votar: 'skip',
  repeat: 'repeat',
  repetir: 'repeat',
  loop: 'repeat',
  seek: 'seek',
  avancar: 'seek',
  avançar: 'seek',
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

/** O que `/repeat` pede: um modo, ou (sem nada) passar para o seguinte; `null` se não entendi. */
export function parseRepeatMode(args: string): 'off' | 'one' | 'all' | 'next' | null {
  const word = args.trim().toLowerCase();
  if (word === '') return 'next';
  if (['off', 'desligar', 'desligado', 'nao', 'não', '0'].includes(word)) return 'off';
  if (['one', 'musica', 'música', 'uma', 'essa', '1'].includes(word)) return 'one';
  if (['all', 'fila', 'tudo', 'todas', 'lista'].includes(word)) return 'all';
  return null;
}

/**
 * Para onde `/seek` vai: um ponto ("1:30", "1:02:05" ou "90") ou, com + ou - na frente, um deslocamento ("+30", "-1:00").
 * `null` se não dá para ler.
 */
export function parseSeekTarget(args: string): { relative: boolean; seconds: number } | null {
  const match = /^([+-])?\s*(\d{1,5}(?::\d{2}){0,2})$/.exec(args.trim());
  if (!match) return null;
  const parts = match[2].split(':').map(Number);
  if (parts.length > 1 && parts.slice(1).some((p) => p > 59)) return null;
  const seconds = parts.reduce((total, part) => total * 60 + part, 0);
  if (seconds > 24 * 3600) return null;
  return match[1] ? { relative: true, seconds: match[1] === '-' ? -seconds : seconds } : { relative: false, seconds };
}

export const HELP_TEXT = [
  '**Comandos do Coreto Música** (entre num canal de voz antes):',
  '`/play <link do YouTube ou Spotify, ou o nome da música>`: toca ou entra na fila',
  '`/playnext <link ou busca>`: coloca na frente da fila, para tocar a seguir',
  '`/skip`: pula a música (com mais de duas pessoas na sala, é uma votação: a metade mais um precisa votar; quem pediu a música pula direto)',
  '`/pause` e `/resume`: pausam e continuam · `/seek 1:30` (ou `/seek +30`, `/seek -15`): vai para um ponto da música',
  '`/repeat`: repete a música ou a fila (`/repeat off`, `/repeat musica` ou `/repeat fila`)',
  '`/queue`: mostra a fila · `/now`: o que está tocando · `/shuffle`: embaralha a fila · `/clear`: esvazia a fila',
  '`/volume <0 a 150>`: volume do bot para todos (100 é o normal) · `/stop`: para tudo e sai da chamada',
].join('\n');
