import { describe, expect, it } from 'vitest';
import { parseCommand } from '../../src/music/commands.js';
import { parseMusicRequest } from '../../src/music/links.js';
import { describeTrack, formatDuration, TrackQueue, type Track } from '../../src/music/queue.js';
import { parseEmbed } from '../../src/music/spotify.js';
import { explainYtDlpError } from '../../src/music/ytdlp-source.js';
import { mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { musicConfigFromEnv } from '../../src/music/config.js';
import { CookieJar } from '../../src/music/cookies.js';

describe('links do bot de música', () => {
  const id = 'dQw4w9WgXcQ';

  it.each([
    [`https://www.youtube.com/watch?v=${id}`],
    [`https://youtube.com/watch?v=${id}&t=43s&list=PLabcdefghijk`],
    [`https://m.youtube.com/watch?v=${id}`],
    [`https://music.youtube.com/watch?v=${id}&si=xyz`],
    [`https://youtu.be/${id}?si=abc`],
    [`https://www.youtube.com/shorts/${id}`],
    [`https://www.youtube.com/live/${id}`],
    [`youtube.com/watch?v=${id}`],
  ])('reconhece o vídeo em %s', (link) => {
    expect(parseMusicRequest(link)).toEqual({ kind: 'youtube-video', id });
  });

  it('reconhece playlist do YouTube', () => {
    expect(parseMusicRequest('https://www.youtube.com/playlist?list=PLrAXtmErZgOeiKm4sgNOknGvNjby9efdf')).toEqual({
      kind: 'youtube-playlist',
      id: 'PLrAXtmErZgOeiKm4sgNOknGvNjby9efdf',
    });
  });

  it('reconhece links e URIs do Spotify', () => {
    const track = '4cOdK2wGLETKBW3PvgPWqT';
    expect(parseMusicRequest(`https://open.spotify.com/track/${track}?si=abc`)).toEqual({ kind: 'spotify', type: 'track', id: track });
    expect(parseMusicRequest(`https://open.spotify.com/intl-pt/album/${track}`)).toEqual({ kind: 'spotify', type: 'album', id: track });
    expect(parseMusicRequest(`https://open.spotify.com/playlist/${track}`)).toEqual({ kind: 'spotify', type: 'playlist', id: track });
    expect(parseMusicRequest(`spotify:track:${track}`)).toEqual({ kind: 'spotify', type: 'track', id: track });
  });

  it('trata texto solto como busca, sem espaços sobrando', () => {
    expect(parseMusicRequest('  never   gonna give you up ')).toEqual({ kind: 'search', query: 'never gonna give you up' });
  });

  it.each([
    ['file:///etc/passwd'],
    ['https://exemplo.com/musica.mp3'],
    ['https://evil.com/?https://youtube.com/watch?v=dQw4w9WgXcQ'],
    ['http://localhost:3001/health'],
    ['ftp://youtube.com/watch?v=dQw4w9WgXcQ'],
    ['https://www.youtube.com/watch?v=curto'],
    ['https://www.youtube.com/channel/UCxyz'],
    ['https://open.spotify.com/episode/4cOdK2wGLETKBW3PvgPWqT'],
    ['https://open.spotify.com/track/curto'],
    [''],
  ])('recusa %s', (text) => {
    expect(parseMusicRequest(text).kind).toBe('invalid');
  });

  it('recusa buscas enormes', () => {
    expect(parseMusicRequest('a'.repeat(300)).kind).toBe('invalid');
  });
});

describe('comandos do bot de música', () => {
  it('lê o comando e o resto da mensagem, com apelidos em português', () => {
    expect(parseCommand('/play  https://youtu.be/dQw4w9WgXcQ ')).toEqual({ name: 'play', args: 'https://youtu.be/dQw4w9WgXcQ' });
    expect(parseCommand('/tocar rick astley')).toEqual({ name: 'play', args: 'rick astley' });
    expect(parseCommand('/PULAR')).toEqual({ name: 'skip', args: '' });
    expect(parseCommand('/vol 50')).toEqual({ name: 'volume', args: '50' });
    expect(parseCommand('/fila')).toEqual({ name: 'queue', args: '' });
  });

  it('ignora o que não é comando', () => {
    expect(parseCommand('oi pessoal')).toBeNull();
    expect(parseCommand('/shrug')).toBeNull();
    expect(parseCommand('veja /play no meio')).toBeNull();
    expect(parseCommand('//play')).toBeNull();
    expect(parseCommand('')).toBeNull();
  });
});

describe('fila de músicas', () => {
  const track = (title: string): Track => ({ requestedBy: 'Ana', title, artist: null, durationSeconds: 100, source: title });

  it('toca na ordem em que foi pedido', () => {
    const queue = new TrackQueue(5);
    expect(queue.add([track('a'), track('b'), track('c')])).toBe(3);
    expect(queue.advance()?.title).toBe('a');
    expect(queue.current?.title).toBe('a');
    expect(queue.advance()?.title).toBe('b');
    expect(queue.size).toBe(1);
    expect(queue.advance()?.title).toBe('c');
    expect(queue.advance()).toBeNull();
    expect(queue.current).toBeNull();
  });

  it('respeita o tamanho máximo e diz quantas coube', () => {
    const queue = new TrackQueue(2);
    expect(queue.add([track('a'), track('b'), track('c')])).toBe(2);
    expect(queue.add([track('d')])).toBe(0);
    expect(queue.upcoming().map((t) => t.title)).toEqual(['a', 'b']);
  });

  it('limpar esvazia a espera mas mantém a atual; reset esvazia tudo', () => {
    const queue = new TrackQueue(5);
    queue.add([track('a'), track('b'), track('c')]);
    queue.advance();
    expect(queue.clearWaiting()).toBe(2);
    expect(queue.current?.title).toBe('a');
    queue.reset();
    expect(queue.current).toBeNull();
  });

  it('formata duração e descrição', () => {
    expect(formatDuration(0)).toBe('0:00');
    expect(formatDuration(65)).toBe('1:05');
    expect(formatDuration(3725)).toBe('1:02:05');
    expect(formatDuration(null)).toBe('');
    expect(describeTrack({ ...track('Sem tempo'), durationSeconds: null })).toBe('**Sem tempo**');
    expect(describeTrack({ ...track('Música'), artist: 'Banda', durationSeconds: 215 })).toBe('**Música** — Banda (3:35)');
  });
});

describe('leitura do Spotify (página de incorporação)', () => {
  const page = (entity: unknown) =>
    `<html><script id="__NEXT_DATA__" type="application/json">${JSON.stringify({ props: { pageProps: { state: { data: { entity } } } } })}</script></html>`;

  it('lê uma música com artistas e duração', () => {
    const result = parseEmbed(
      page({ type: 'track', name: 'Never Gonna Give You Up', artists: [{ name: 'Rick Astley' }], duration: 213573 }),
      'track',
    );
    expect(result).toEqual({
      name: 'Never Gonna Give You Up',
      tracks: [{ title: 'Never Gonna Give You Up', artist: 'Rick Astley', durationSeconds: 214 }],
    });
  });

  it('lê álbuns e playlists, ignorando itens sem título', () => {
    const result = parseEmbed(
      page({
        type: 'playlist',
        name: 'Hits',
        trackList: [
          { title: 'Primeira', subtitle: 'Ana,\u00a0Bia', duration: 120000 },
          { title: '', subtitle: 'ninguém' },
          { title: 'Segunda', subtitle: '', duration: 0 },
        ],
      }),
      'playlist',
    );
    expect(result?.tracks).toEqual([
      { title: 'Primeira', artist: 'Ana, Bia', durationSeconds: 120 },
      { title: 'Segunda', artist: null, durationSeconds: null },
    ]);
  });

  it('devolve null quando a página mudou ou veio sem o que se espera', () => {
    expect(parseEmbed('<html>nada</html>', 'track')).toBeNull();
    expect(parseEmbed('<script id="__NEXT_DATA__" type="application/json">{quebrado</script>', 'track')).toBeNull();
    expect(parseEmbed(page({ type: 'playlist', name: 'Vazia', trackList: [] }), 'playlist')).toBeNull();
    expect(parseEmbed(page({ type: 'album', name: 'Sem lista' }), 'album')).toBeNull();
  });
});

describe('erros do yt-dlp em português', () => {
  it.each([
    ["ERROR: [youtube] abc: Sign in to confirm you're not a bot", 'bloqueou este servidor'],
    ['ERROR: [youtube] abc: Private video. Sign in if you\'ve been granted access', 'privado'],
    ['ERROR: [youtube] abc: Video unavailable', 'não está disponível'],
    ['ERROR: [youtube] abc: This video is age-restricted', 'idade'],
    ['ERROR: coisa estranha e nova', 'Não consegui carregar: coisa estranha e nova'],
    ['', 'Não consegui carregar esse áudio'],
  ])('%s', (stderr, expected) => {
    expect(explainYtDlpError(stderr)).toContain(expected);
  });
});

describe('erro de bloqueio com e sem cookies', () => {
  it('manda configurar os cookies, ou renová-los se já existirem', () => {
    const blocked = "ERROR: Sign in to confirm you're not a bot";
    expect(explainYtDlpError(blocked)).toContain('YTDLP_COOKIES_FILE');
    expect(explainYtDlpError(blocked, true)).toContain('exportar o cookies.txt de novo');
  });
});

describe('cookies do YouTube', () => {
  it('trabalha numa cópia (o original pode ser somente leitura) e a atualiza quando o original muda', () => {
    const dir = mkdtempSync(join(tmpdir(), 'coreto-cookies-'));
    try {
      const original = join(dir, 'cookies.txt');
      const header = '# Netscape HTTP Cookie File';
      writeFileSync(original, `${header} A`);
      const jar = new CookieJar(original);
      const copy = jar.path();
      expect(copy).not.toBeNull();
      expect(copy).not.toBe(original);
      expect(readFileSync(copy!, 'utf8')).toContain('A');

      // O yt-dlp regrava a cópia; o original não é tocado.
      writeFileSync(copy!, 'renovado');
      expect(jar.path()).toBe(copy);
      expect(readFileSync(copy!, 'utf8')).toBe('renovado');
      expect(readFileSync(original, 'utf8')).toContain('A');

      // O administrador trocou o arquivo: a cópia é refeita.
      writeFileSync(original, `${header} B`);
      const later = new Date(Date.now() + 5000);
      utimesSync(original, later, later);
      expect(readFileSync(jar.path()!, 'utf8')).toContain('B');
      rmSync(copy!, { force: true });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('sem arquivo configurado, ou com arquivo que não existe, segue sem cookies', () => {
    expect(new CookieJar(null).path()).toBeNull();
    expect(new CookieJar(join(tmpdir(), 'coreto-nao-existe.txt')).path()).toBeNull();
  });

  it('lê os argumentos extras do yt-dlp do ambiente', () => {
    expect(musicConfigFromEnv({ YTDLP_EXTRA_ARGS: ' --proxy   socks5://h:1080 ' }).extraArgs).toEqual(['--proxy', 'socks5://h:1080']);
    expect(musicConfigFromEnv({}).extraArgs).toEqual([]);
  });
});
