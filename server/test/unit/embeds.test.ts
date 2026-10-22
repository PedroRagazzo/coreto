import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { firstLink } from '../../../shared/src/links.js';
import { isPublicAddress } from '../../src/embeds/address.js';
import { decodeEntities, parsePage } from '../../src/embeds/html.js';
import { sniffImage } from '../../src/embeds/image-size.js';
import { createEmbeds } from '../../src/embeds/service.js';
import { safeGet, UnsafeUrlError } from '../../src/embeds/safe-fetch.js';
import { TINY_GIF, TINY_PNG, WebFixture } from '../support/web-fixture.js';

describe('isPublicAddress', () => {
  it.each(['8.8.8.8', '1.1.1.1', '93.184.216.34', '172.15.0.1', '172.32.0.1', '2606:4700:4700::1111', '2001:4860:4860::8888'])('aceita %s', (ip) => {
    expect(isPublicAddress(ip)).toBe(true);
  });

  it.each([
    '0.0.0.0',
    '10.1.2.3',
    '127.0.0.1',
    '100.64.0.1',
    '169.254.169.254', // metadados da nuvem
    '172.16.0.1',
    '172.31.255.255',
    '192.168.1.1',
    '198.18.0.1',
    '224.0.0.1',
    '255.255.255.255',
    '::',
    '::1',
    'fe80::1',
    'fd00::1',
    'fc00::1',
    'ff02::1',
    '::ffff:127.0.0.1', // IPv4 escondido num IPv6
    '::ffff:7f00:1',
    '::ffff:10.0.0.1',
    '64:ff9b::a00:1', // tradução NAT64 para 10.0.0.1
    '2002:7f00:1::1', // 6to4 carregando 127.0.0.1
    '2001:db8::1',
  ])('recusa %s', (ip) => {
    expect(isPublicAddress(ip)).toBe(false);
  });

  it('recusa o que não é um endereço', () => {
    for (const ip of ['', 'localhost', '999.1.1.1', '1.2.3', 'gggg::1', '1.2.3.4.5']) expect(isPublicAddress(ip)).toBe(false);
  });
});

describe('firstLink', () => {
  it('acha o primeiro link e tira a pontuação do fim', () => {
    expect(firstLink('olha isso https://exemplo.com/a?b=1, depois https://outro.com')).toBe('https://exemplo.com/a?b=1');
    expect(firstLink('(veja https://exemplo.com/x)')).toBe('https://exemplo.com/x');
    expect(firstLink('é https://pt.wikipedia.org/wiki/Foo_(bar).')).toBe('https://pt.wikipedia.org/wiki/Foo_(bar)');
    expect(firstLink('http://exemplo.com!')).toBe('http://exemplo.com');
  });

  it('ignora o que está em código, e o que não é http(s)', () => {
    expect(firstLink('`https://nao.com` e ```\nhttps://nem.com\n``` fim')).toBeNull();
    expect(firstLink('`https://nao.com` mas https://sim.com')).toBe('https://sim.com');
    expect(firstLink('ftp://exemplo.com e javascript:alert(1)')).toBeNull();
    expect(firstLink('sem link nenhum')).toBeNull();
    expect(firstLink(`https://exemplo.com/${'a'.repeat(2100)}`)).toBeNull();
  });
});

describe('parsePage', () => {
  it('lê as tags Open Graph, decodifica entidades e torna a imagem absoluta', () => {
    const page = parsePage(
      `<head><meta property="og:title" content="A &amp; B &#39;c&#x27; &quot;d&quot;"><meta property="og:description" content="  duas
 linhas "><meta property="og:image" content="/img/capa.png"><meta property="og:site_name" content="Meu Site"></head>`,
      'https://exemplo.com/artigo/1',
    );
    expect(page).toMatchObject({
      title: 'A & B \'c\' "d"',
      description: 'duas linhas',
      siteName: 'Meu Site',
      image: 'https://exemplo.com/img/capa.png',
    });
  });

  it('cai nas tags do Twitter, no <title> e na descrição comum', () => {
    expect(parsePage('<head><title> Só o título </title><meta name="description" content="descrição simples"></head>', 'https://a.com')).toMatchObject({
      title: 'Só o título',
      description: 'descrição simples',
      image: null,
    });
    expect(parsePage('<meta name="twitter:title" content="T"><meta name="twitter:image" content="https://cdn.com/i.jpg">', 'https://a.com')).toMatchObject({
      title: 'T',
      image: 'https://cdn.com/i.jpg',
    });
  });

  it('corta o que é longo, ignora imagem que não é http(s) e não olha o corpo da página', () => {
    const page = parsePage(`<head><meta property="og:title" content="${'t'.repeat(400)}"><meta property="og:image" content="javascript:alert(1)"></head><body><meta property="og:description" content="de dentro do corpo"></body>`, 'https://a.com');
    expect(page.title).toHaveLength(150);
    expect(page.title?.endsWith('…')).toBe(true);
    expect(page.image).toBeNull();
    expect(page.description).toBeNull();
  });

  it('nunca devolve HTML: tags no texto ficam como texto', () => {
    expect(parsePage('<meta property="og:title" content="&lt;img src=x onerror=alert(1)&gt;">', 'https://a.com').title).toBe('<img src=x onerror=alert(1)>');
  });

  it('decodeEntities deixa em paz o que não conhece', () => {
    expect(decodeEntities('&naoexiste; &#0; &#99999999; &amp;')).toBe('&naoexiste; &#0; &#99999999; &');
  });
});

describe('sniffImage', () => {
  it('lê tipo e tamanho de PNG e GIF', () => {
    expect(sniffImage(TINY_PNG)).toEqual({ type: 'image/png', width: 1, height: 1 });
    expect(sniffImage(TINY_GIF)).toEqual({ type: 'image/gif', width: 3, height: 2 });
  });

  it('lê o tamanho de um JPEG e de WebP', () => {
    const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x04, 0, 0, 0xff, 0xc0, 0x00, 0x11, 8, 0x01, 0x2c, 0x02, 0x58, 3, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1]);
    expect(sniffImage(jpeg)).toEqual({ type: 'image/jpeg', width: 600, height: 300 });
    const webp = Buffer.alloc(30);
    webp.write('RIFF', 0);
    webp.write('WEBP', 8);
    webp.write('VP8 ', 12);
    webp.writeUInt16LE(640, 26);
    webp.writeUInt16LE(480, 28);
    expect(sniffImage(webp)).toEqual({ type: 'image/webp', width: 640, height: 480 });
  });

  it('só reconhece imagens que o navegador exibe sem risco', () => {
    expect(sniffImage(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>'))).toBeNull();
    expect(sniffImage(Buffer.from('<html><script>alert(1)</script></html>'))).toBeNull();
    expect(sniffImage(Buffer.alloc(0))).toBeNull();
  });
});

describe('busca segura e pré-visualização', () => {
  let site: WebFixture;
  beforeAll(async () => {
    site = await WebFixture.start();
  });
  afterAll(() => site.stop());

  const open = () => createEmbeds({ allowPrivate: true });
  const any = { limit: () => 1024, allowPrivate: false } as const;

  it('por padrão recusa a própria máquina e a rede interna', async () => {
    await expect(safeGet(site.url('/pagina'), any)).rejects.toBeInstanceOf(UnsafeUrlError);
    await expect(safeGet('http://localhost:80/', any)).rejects.toBeInstanceOf(UnsafeUrlError);
    await expect(safeGet('http://[::1]/', any)).rejects.toBeInstanceOf(UnsafeUrlError);
    await expect(safeGet('http://169.254.169.254/latest/meta-data/', any)).rejects.toBeInstanceOf(UnsafeUrlError);
    await expect(safeGet('http://painel.internal/', any)).rejects.toBeInstanceOf(UnsafeUrlError);
    await expect(safeGet('http://8.8.8.8:22/', any)).rejects.toBeInstanceOf(UnsafeUrlError); // porta estranha
    await expect(safeGet('http://usuario:senha@8.8.8.8/', any)).rejects.toBeInstanceOf(UnsafeUrlError);
    await expect(safeGet('file:///etc/passwd', any)).rejects.toBeInstanceOf(UnsafeUrlError);
    expect(site.hits).toEqual([]);
    // Pelo serviço, o endereço recusado vira "sem pré-visualização", sem erro.
    expect(await createEmbeds().preview(site.url('/pagina'))).toBeNull();
    expect(site.hits).toEqual([]);
  });

  it('monta o cartão de uma página com título, descrição, site e imagem', async () => {
    const embeds = open();
    const preview = (await embeds.preview(site.url('/pagina')))!;
    expect(preview).toMatchObject({
      url: site.url('/pagina'),
      kind: 'page',
      title: 'Um "título" & tanto',
      description: 'Descrição da página',
      siteName: 'Site de Teste',
      image: { width: 1200, height: 630 },
    });
    // A imagem sai pelo servidor, com o tipo conferido pelos bytes.
    const image = (await embeds.image(preview.image!.id))!;
    expect(image.type).toBe('image/png');
    expect(image.body.equals(TINY_PNG)).toBe(true);
  });

  it('entende resposta comprimida e segue redirecionamento', async () => {
    const embeds = open();
    expect((await embeds.preview(site.url('/comprimida')))?.title).toBe('Um "título" & tanto');
    expect((await embeds.preview(site.url('/redireciona')))?.siteName).toBe('Site de Teste');
  });

  it('um link que é uma imagem ou GIF vira a própria imagem, com o tamanho', async () => {
    const embeds = open();
    const preview = (await embeds.preview(site.url('/imagem.gif')))!;
    expect(preview).toMatchObject({ kind: 'image', title: null, image: { width: 3, height: 2 } });
    expect((await embeds.image(preview.image!.id))?.type).toBe('image/gif');
  });

  it('não entrega como imagem o que não é imagem, nem SVG', async () => {
    const embeds = open();
    expect(await embeds.preview(site.url('/svg'))).toBeNull();
    expect(await embeds.preview(site.url('/texto'))).toBeNull();
    expect(await embeds.preview(site.url('/vazia'))).toBeNull();
    expect(await embeds.preview(site.url('/nao-existe'))).toBeNull();
    // Uma "imagem" que na verdade é HTML: o cartão até sai (veio como image/png), mas o arquivo é recusado.
    const liar = await embeds.preview(site.url('/mentirosa.png'));
    expect(liar).toBeNull();
  });

  it('desiste de redirecionamento sem fim e de página enorme sem ler tudo', async () => {
    const embeds = open();
    expect(await embeds.preview(site.url('/laco'))).toBeNull();
    // Só os primeiros 512 KB são lidos; o título está no começo, então ainda dá para montar o cartão.
    expect((await embeds.preview(site.url('/gigante')))?.title).toBe('Começo');
  });

  it('desiste de quem não responde', async () => {
    const started = Date.now();
    await expect(safeGet(site.url('/lenta'), { limit: () => 1024, allowPrivate: true, timeoutMs: 300 })).rejects.toThrow(/tempo esgotado/);
    expect(Date.now() - started).toBeLessThan(2000);
  });

  it('guarda o resultado: o mesmo link não visita o site de novo', async () => {
    const embeds = open();
    const before = site.hits.filter((h) => h === '/pagina').length;
    const [a, b] = await Promise.all([embeds.preview(site.url('/pagina')), embeds.preview(site.url('/pagina'))]);
    await embeds.preview(site.url('/pagina'));
    expect(a).toBe(b);
    expect(site.hits.filter((h) => h === '/pagina').length - before).toBe(1);
  });

  it('só serve imagens que um cartão registrou', async () => {
    const embeds = open();
    expect(await embeds.image('00000000-0000-0000-0000-000000000000')).toBeNull();
  });
});
