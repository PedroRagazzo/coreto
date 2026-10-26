import type { Attachment } from '@shared/models';
import { MAX_ATTACHMENT_BYTES, type UploadResponse } from '@shared/protocol';
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

/** Envia uma imagem ou um arquivo para POST /uploads. XMLHttpRequest (e não fetch) para acompanhar o progresso. */
export function uploadFile(token: string, file: File, onProgress: (fraction: number) => void): UploadHandle {
  const xhr = new XMLHttpRequest();
  const done = new Promise<UploadResponse>((resolve) => {
    const fail = (error: string) => resolve({ ok: false, error });
    xhr.open('POST', `${SERVER_URL}/uploads`);
    xhr.setRequestHeader('authorization', `Bearer ${token}`);
    xhr.setRequestHeader('x-file-name', encodeURIComponent(file.name));
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress(e.loaded / e.total);
    };
    xhr.onload = () => {
      try {
        resolve(JSON.parse(xhr.responseText) as UploadResponse);
      } catch {
        fail(`O servidor recusou o arquivo (${xhr.status}).`);
      }
    };
    xhr.onerror = () => fail('Não foi possível enviar o arquivo. O servidor está rodando?');
    xhr.onabort = () => fail('Envio cancelado.');
    xhr.send(file);
  });
  return { done, abort: () => xhr.abort() };
}
