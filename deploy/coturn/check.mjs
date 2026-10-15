// Confere um servidor TURN de fora, sem precisar do segredo:
//   1. STUN Binding por UDP e por TCP: a porta responde e diz o seu IP público;
//   2. TURN Allocate sem credencial: o servidor exige autenticação (401 + realm).
//
//   node deploy/coturn/check.mjs <host> [porta]
// Sai com código 1 se alguma checagem falhar.

import { randomBytes } from 'node:crypto';
import dgram from 'node:dgram';
import net from 'node:net';

const [host, portArg] = process.argv.slice(2);
if (!host) {
  console.error('uso: node check.mjs <host> [porta]');
  process.exit(2);
}
const port = Number(portArg ?? 3478);
const MAGIC = 0x2112a442;
const TIMEOUT_MS = 4000;

/** Mensagem STUN: cabeçalho de 20 bytes + atributos. */
function message(type, attributes = []) {
  const body = Buffer.concat(attributes);
  const header = Buffer.alloc(20);
  header.writeUInt16BE(type, 0);
  header.writeUInt16BE(body.length, 2);
  header.writeUInt32BE(MAGIC, 4);
  randomBytes(12).copy(header, 8);
  return Buffer.concat([header, body]);
}

function attribute(type, value) {
  const padded = Buffer.alloc(Math.ceil(value.length / 4) * 4);
  value.copy(padded);
  const head = Buffer.alloc(4);
  head.writeUInt16BE(type, 0);
  head.writeUInt16BE(value.length, 2);
  return Buffer.concat([head, padded]);
}

function parse(buf) {
  const type = buf.readUInt16BE(0);
  const length = buf.readUInt16BE(2);
  const attrs = new Map();
  for (let i = 20; i + 4 <= 20 + length; ) {
    const t = buf.readUInt16BE(i);
    const l = buf.readUInt16BE(i + 2);
    attrs.set(t, buf.subarray(i + 4, i + 4 + l));
    i += 4 + Math.ceil(l / 4) * 4;
  }
  return { type, attrs };
}

/** XOR-MAPPED-ADDRESS (IPv4): o IP:porta de quem perguntou, visto pelo servidor. */
function mappedAddress(attrs) {
  const value = attrs.get(0x0020);
  if (!value || value[1] !== 0x01) return null;
  const xport = value.readUInt16BE(2) ^ (MAGIC >>> 16);
  const ip = (value.readUInt32BE(4) ^ MAGIC) >>> 0;
  return `${ip >>> 24}.${(ip >>> 16) & 255}.${(ip >>> 8) & 255}.${ip & 255}:${xport}`;
}

function viaUdp(request) {
  return new Promise((resolve, reject) => {
    const socket = dgram.createSocket('udp4');
    const timer = setTimeout(() => {
      socket.close();
      reject(new Error('sem resposta por UDP'));
    }, TIMEOUT_MS);
    socket.on('message', (msg) => {
      clearTimeout(timer);
      socket.close();
      resolve(parse(msg));
    });
    socket.send(request, port, host);
  });
}

function viaTcp(request) {
  return new Promise((resolve, reject) => {
    const socket = net.connect(port, host);
    const timer = setTimeout(() => {
      socket.destroy();
      reject(new Error('sem resposta por TCP'));
    }, TIMEOUT_MS);
    let data = Buffer.alloc(0);
    socket.on('connect', () => socket.write(request));
    socket.on('data', (chunk) => {
      data = Buffer.concat([data, chunk]);
      if (data.length >= 20 && data.length >= 20 + data.readUInt16BE(2)) {
        clearTimeout(timer);
        socket.end();
        resolve(parse(data));
      }
    });
    socket.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });
}

let failed = false;
const check = async (label, run) => {
  try {
    console.log(`ok    ${label}: ${await run()}`);
  } catch (err) {
    failed = true;
    console.log(`FALHA ${label}: ${err.message}`);
  }
};

await check('STUN Binding por UDP', async () => {
  const res = await viaUdp(message(0x0001));
  if (res.type !== 0x0101) throw new Error(`resposta inesperada 0x${res.type.toString(16)}`);
  return `seu endereço visto pelo servidor é ${mappedAddress(res.attrs)}`;
});

await check('STUN Binding por TCP', async () => {
  const res = await viaTcp(message(0x0001));
  if (res.type !== 0x0101) throw new Error(`resposta inesperada 0x${res.type.toString(16)}`);
  return `seu endereço visto pelo servidor é ${mappedAddress(res.attrs)}`;
});

await check('TURN exige autenticação', async () => {
  // Allocate (0x0003) pedindo transporte UDP (17), sem usuário: o esperado é 401 com o realm.
  const res = await viaUdp(message(0x0003, [attribute(0x0019, Buffer.from([17, 0, 0, 0]))]));
  const error = res.attrs.get(0x0009);
  const code = error ? error[2] * 100 + error[3] : null;
  if (res.type !== 0x0113 || code !== 401) throw new Error(`esperava erro 401, veio 0x${res.type.toString(16)} ${code}`);
  return `401 com realm "${res.attrs.get(0x0014)?.toString()}"`;
});

process.exit(failed ? 1 : 0);
