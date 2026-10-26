// Estado global em tempo real: um socket por sessão, eventos do servidor viram ações do reducer, e os componentes
// chamam `actions` para agir.
//
//   state.ts          o formato do estado e o ponto de partida
//   types.ts          as ações do reducer (`Action`) e as que os componentes chamam (`RealtimeActions`)
//   reducer/          o reducer, dividido em session (conexão, espaços, canais), messages e voice
//   actions/          as `RealtimeActions`, divididas em navigation, messages e voice
//   socket-events.ts  a ligação com o servidor: cada evento vira uma ação do reducer ou uma notificação
//   effects.ts        efeitos que acompanham o estado (não lidas, título da janela, voz)
//   context.ts        o que as ações e os eventos compartilham (dispatch e referências)

import { createContext, useContext, useEffect, useMemo, useReducer, useRef, type ReactNode } from 'react';
import type { Id } from '@shared/models';
import type { Identity } from '../../lib/identity';
import type { AppSocket } from '../../lib/socket';
import { DEFAULT_SETTINGS } from '../../lib/settings';
import type { VoiceManager } from '../../lib/voice';
import { useSettings } from '../settings';
import { createActions } from './actions';
import type { ActionContext } from './context';
import { useReadTracking, useUnreadTitle, useVoiceSync } from './effects';
import { reducer } from './reducer';
import { connectSocket } from './socket-events';
import { initialState, type RealtimeState } from './state';
import type { RealtimeActions } from './types';

interface RealtimeContextValue {
  state: RealtimeState;
  actions: RealtimeActions;
}

const RealtimeContext = createContext<RealtimeContextValue | null>(null);

interface RealtimeProviderProps {
  identity: Identity;
  /** O servidor recusou a sessão guardada: é preciso entrar de novo. */
  onSessionInvalid: () => void;
  children: ReactNode;
}

export function RealtimeProvider({ identity, onSessionInvalid, children }: RealtimeProviderProps) {
  const [state, dispatch] = useReducer(reducer, initialState);
  const onSessionInvalidRef = useRef(onSessionInvalid);
  onSessionInvalidRef.current = onSessionInvalid;
  const stateRef = useRef(state);
  stateRef.current = state;

  const socketRef = useRef<AppSocket | null>(null);
  const voiceRef = useRef<VoiceManager | null>(null);
  const lastTypingRef = useRef<{ channelId: Id | null; at: number }>({ channelId: null, at: 0 });
  const previewsAskedRef = useRef(new Set<string>());
  /** As preferências de notificação valem na hora, sem refazer a conexão com o servidor. */
  const notificationPrefsRef = useRef(DEFAULT_SETTINGS.notifications);
  const firstSessionRef = useRef(true);
  const identityRef = useRef(identity);
  identityRef.current = identity;

  // Tudo aqui é estável (o `dispatch` e as referências), então as ações são criadas uma vez só.
  const ctx = useMemo<ActionContext>(
    () => ({ dispatch, stateRef, socketRef, voiceRef, identityRef, lastTypingRef, previewsAskedRef }),
    [dispatch],
  );
  const actions = useMemo(() => createActions(ctx), [ctx]);

  useEffect(
    () => connectSocket({ token: identity.token, ctx, actions, notificationPrefsRef, firstSessionRef, onSessionInvalidRef }),
    [identity, ctx, actions],
  );

  const { settings } = useSettings();
  notificationPrefsRef.current = settings.notifications;

  useReadTracking(state, ctx);
  useUnreadTitle(state);
  useVoiceSync(state, ctx, settings.voice, identity);

  const value = useMemo(() => ({ state, actions }), [state, actions]);
  return <RealtimeContext.Provider value={value}>{children}</RealtimeContext.Provider>;
}

export function useRealtime(): RealtimeContextValue {
  const value = useContext(RealtimeContext);
  if (!value) throw new Error('useRealtime precisa estar dentro de <RealtimeProvider>.');
  return value;
}
