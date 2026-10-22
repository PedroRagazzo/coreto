// Um "site" de mentira na máquina de teste, para a pré-visualização de links buscar de verdade (por HTTP real).

import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { gzipSync } from 'node:zlib';

/** PNG de 1×1 pixel (cabeçalho válido, o que basta para o tipo e o tamanho). */
export const TINY_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
);

/** GIF de 3×2 pixels (só o cabeçalho). */
export const TINY_GIF = Buffer.concat([Buffer.from('GIF89a'), Buffer.from([3, 0, 2, 0, 0, 0, 0]), Buffer.alloc(16)]);

export const PAGE_HTML = `<!doctype html><html><head>
<meta charset="utf-8">
<title>Título comum</title>
<meta property="og:title" content="Um &quot;título&quot; &amp; tanto">
<meta property="og:description" content="Descrição   da
página">
<meta property="og:site_name" content="Site de Teste">
<meta property="og:image" content="/capa.png">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
</head><body>corpo</body></html>`;

type Route = (req: IncomingMessage, res: ServerResponse) => void;

export class WebFixture {
  readonly hits: string[] = [];
  private readonly routes = new Map<string, Route>();
  private server = createServer((req, res) => {
    this.hits.push(req.url ?? '');
    (this.routes.get((req.url ?? '').split('?')[0]) ?? ((_q, r) => void r.writeHead(404).end()))(req, res);
  });
  port = 0;

  static async start(): Promise<WebFixture> {
    const fixture = new WebFixture();
    await new Promise<void>((resolve) => fixture.server.listen(0, '127.0.0.1', resolve));
    fixture.port = (fixture.server.address() as AddressInfo).port;
    fixture.install();
    return fixture;
  }

  url(path: string): string {
    return `http://127.0.0.1:${this.port}${path}`;
  }

  route(path: string, handler: Route): void {
    this.routes.set(path, handler);
  }

  async stop(): Promise<void> {
    this.server.closeAllConnections();
    await new Promise((resolve) => this.server.close(resolve));
  }

  private install(): void {
    this.route('/pagina', (_req, res) => void res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }).end(PAGE_HTML));
    this.route('/comprimida', (_req, res) =>
      void res.writeHead(200, { 'content-type': 'text/html', 'content-encoding': 'gzip' }).end(gzipSync(PAGE_HTML)),
    );
    this.route('/capa.png', (_req, res) => void res.writeHead(200, { 'content-type': 'image/png' }).end(TINY_PNG));
    this.route('/imagem.gif', (_req, res) => void res.writeHead(200, { 'content-type': 'image/gif' }).end(TINY_GIF));
    // Diz que é PNG mas o conteúdo é HTML com script: não pode ser entregue como imagem.
    this.route('/mentirosa.png', (_req, res) =>
      void res.writeHead(200, { 'content-type': 'image/png' }).end('<html><script>alert(1)</script></html>'),
    );
    this.route('/svg', (_req, res) =>
      void res.writeHead(200, { 'content-type': 'image/svg+xml' }).end('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'),
    );
    this.route('/texto', (_req, res) => void res.writeHead(200, { 'content-type': 'text/plain' }).end('só texto'));
    this.route('/vazia', (_req, res) => void res.writeHead(200, { 'content-type': 'text/html' }).end('<html><head></head><body>nada</body></html>'));
    this.route('/redireciona', (_req, res) => void res.writeHead(302, { location: '/pagina' }).end());
    this.route('/laco', (_req, res) => void res.writeHead(302, { location: '/laco' }).end());
    this.route('/gigante', (_req, res) => {
      res.writeHead(200, { 'content-type': 'text/html' });
      res.write('<html><head><title>Começo</title></head><body>');
      res.end('x'.repeat(2 * 1024 * 1024));
    });
    this.route('/lenta', () => {
      // Nunca responde: o servidor precisa desistir sozinho.
    });
  }
}
