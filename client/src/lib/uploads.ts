import type { Attachment } from '@shared/models';
import { MAX_ATTACHMENT_BYTES, UPLOAD_CHUNK_BYTES, type UploadChunkResponse, type UploadResponse } from '@shared/protocol';
import { SERVER_URL } from './socket';

export interface UploadHandle {
  done: Promise<UploadResponse>;
  abort(): void;
}

export const attachmentUrl = (attachment: Attachment) => `${SERVER_URL}/uploads/${attachment.id}`;

/** A imagem de uma pré-visualização de link, entregue pelo servidor do Coreto (nunca direto do site de origem). */
export const embedImageUrl = (imageId: string) => `${SERVER_URL}/embed-image/${imageId}`;

/** Motivo para recusar o arquivo antes de enviar, ou `null` se ele puder ir. Qualquer tipo vale, até o limite de tamanho. */
export function checkFile(file: File): string | null {
  if (file.size === 0) return `"${file.name}" está vazio.`;
  if (file.size > MAX_ATTACHMENT_BYTES) {
    return `"${file.name}" passa de ${MAX_ATTACHMENT_BYTES / 1024 / 1024} MB.`;
  }
  return null;
}

/** Quantas vezes um pedaço é repetido (conexão caída, proxy cortando) antes de desistir do arquivo. */
const CHUNK_ATTEMPTS = 4;
/** Espera antes de repetir um pedaço: 1 s, 2 s, 4 s... */
const retryDelayMs = (attempt: number) => 1000 * 2 ** (attempt - 1);

const NETWORK_ERROR = 'Não foi possível enviar o arquivo. O servidor está rodando?';

/** Um UUID aleatório: `crypto.randomUUID` só existe em páginas seguras, então há um caminho de reserva. */
function newUploadId(): string {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6]! & 0x0f) | 0x40;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** Um POST /uploads. XMLHttpRequest (e não fetch) para acompanhar o progresso; `status` 0 = a conexão falhou. */
function post(
  token: string,
  file: File,
  body: Blob,
  extraHeaders: Record<string, string>,
  onProgress: (loaded: number) => void,
  setAbort: (abort: () => void) => void,
): Promise<{ status: number; json: UploadChunkResponse | null }> {
  return new Promise((resolve) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `${SERVER_URL}/uploads`);
    xhr.setRequestHeader('authorization', `Bearer ${token}`);
    xhr.setRequestHeader('x-file-name', encodeURIComponent(file.name));
    for (const [name, value] of Object.entries(extraHeaders)) xhr.setRequestHeader(name, value);
    xhr.upload.onprogress = (e) => onProgress(e.loaded);
    xhr.onload = () => {
      let json: UploadChunkResponse | null = null;
      try {
        json = JSON.parse(xhr.responseText) as UploadChunkResponse;
      } catch {
        // o proxy respondeu com uma página de erro, não com o nosso JSON
      }
      resolve({ status: xhr.status, json });
    };
    xhr.onerror = () => resolve({ status: 0, json: null });
    xhr.onabort = () => resolve({ status: -1, json: null });
    setAbort(() => xhr.abort());
    xhr.send(body);
  });
}

/**
 * Envia uma imagem ou um arquivo para POST /uploads. Arquivo pequeno vai de uma vez; um grande vai em pedaços de
 * `UPLOAD_CHUNK_BYTES`, porque o proxy do servidor corta qualquer pedido que leve mais de 60 s (um arquivo de 40 MB
 * passa disso para quem tem upload abaixo de ~5 Mb/s). Cada pedaço é repetido se a conexão falhar.
 */
export function uploadFile(token: string, file: File, onProgress: (fraction: number) => void): UploadHandle {
  let abort = () => {};
  let cancelled = false;

  const run = async (): Promise<UploadResponse> => {
    const fail = (error: string): UploadResponse => ({ ok: false, error });
    const setAbort = (fn: () => void) => void (abort = fn);

    if (file.size <= UPLOAD_CHUNK_BYTES) {
      const { status, json } = await post(token, file, file, {}, (loaded) => onProgress(loaded / file.size), setAbort);
      if (cancelled) return fail('Envio cancelado.');
      if (json && 'attachment' in json && json.ok) return json;
      if (json && !json.ok) return json;
      return fail(status === 0 ? NETWORK_ERROR : `O servidor recusou o arquivo (${status}).`);
    }

    const id = newUploadId();
    let offset = 0;
    let attempt = 0;
    while (true) {
      if (cancelled) return fail('Envio cancelado.');
      const end = Math.min(offset + UPLOAD_CHUNK_BYTES, file.size);
      const headers = { 'x-upload-id': id, 'x-upload-offset': String(offset), 'x-upload-total': String(file.size) };
      const { status, json } = await post(token, file, file.slice(offset, end), headers, (loaded) => onProgress((offset + loaded) / file.size), setAbort);
      if (cancelled) return fail('Envio cancelado.');

      if (json?.ok && 'attachment' in json) return json;
      if (json?.ok) {
        offset = json.received;
        attempt = 0;
        onProgress(offset / file.size);
        continue;
      }
      // Pedaço fora de ordem: o servidor diz até onde já tem (por exemplo, o pedaço chegou mas a resposta se perdeu).
      if (status === 409 && json && !json.ok && typeof json.received === 'number' && json.received !== offset && attempt < CHUNK_ATTEMPTS) {
        offset = json.received;
        attempt++;
        continue;
      }
      // Recusa de verdade (sessão, tamanho, espaço): repetir não adianta.
      if (json && !json.ok && status >= 400 && status < 500 && status !== 408 && status !== 429) return json;
      // Conexão caída, proxy cortando, servidor ocupado: repete o mesmo pedaço.
      attempt++;
      if (attempt >= CHUNK_ATTEMPTS) return fail(json && !json.ok ? json.error : status === 0 ? NETWORK_ERROR : `O servidor recusou o arquivo (${status}).`);
      await new Promise((resolve) => setTimeout(resolve, retryDelayMs(attempt)));
    }
  };

  return {
    done: run(),
    abort: () => {
      cancelled = true;
      abort();
    },
  };
}
