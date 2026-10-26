// O que as ações e os eventos do socket compartilham: o `dispatch` do reducer e as referências (sempre atuais) ao
// estado, ao socket, ao gerenciador de voz e à sessão. Tudo aqui é estável: criar as ações uma vez basta.

import type { Id } from '@shared/models';
import type { Ack } from '@shared/protocol';
import type { Dispatch, MutableRefObject } from 'react';
import type { Identity } from '../../lib/identity';
import type { AppSocket } from '../../lib/socket';
import type { VoiceManager } from '../../lib/voice';
import type { RealtimeState } from './state';
import type { Action } from './types';

export interface ActionContext {
  dispatch: Dispatch<Action>;
  /** O estado de agora (as ações rodam fora da renderização e não podem usar o `state` de uma renderização antiga). */
  stateRef: MutableRefObject<RealtimeState>;
  socketRef: MutableRefObject<AppSocket | null>;
  voiceRef: MutableRefObject<VoiceManager | null>;
  identityRef: MutableRefObject<Identity>;
  /** Último aviso de "digitando" enviado, para não mandar um a cada tecla. */
  lastTypingRef: MutableRefObject<{ channelId: Id | null; at: number }>;
  /** Links cujo cartão já foi pedido (um pedido por link, mesmo que ele apareça em várias mensagens). */
  previewsAskedRef: MutableRefObject<Set<string>>;
}

/** Faz um pedido ao servidor e devolve o erro para mostrar (ou `null` se deu certo). */
export async function ask(ctx: ActionContext, send: (socket: AppSocket) => Promise<Ack<unknown>>): Promise<string | null> {
  const socket = ctx.socketRef.current;
  if (!socket) return 'Sem conexão com o servidor.';
  try {
    const res = await send(socket);
    return res.ok ? null : res.error;
  } catch {
    return 'O servidor não respondeu. Tente de novo.';
  }
}
