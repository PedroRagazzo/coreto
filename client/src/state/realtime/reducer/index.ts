// O reducer do estado em tempo real. Este arquivo só encaminha cada ação para quem a trata; os tratadores ficam em
// session.ts (conexão, espaços, canais, navegação), messages.ts (mensagens) e voice.ts (chamada, transmissões, sons).
// O `switch` cobre todos os tipos de `Action`: acrescentar uma ação sem tratá-la aqui é erro de compilação.

import type { Id } from '@shared/models';
import type { RealtimeState } from '../state';
import type { Action } from '../types';
import * as messages from './messages';
import * as session from './session';
import * as voice from './voice';

/** Os eventos que mudam o que o painel de fixadas mostra: ele recarrega quando o contador do canal sobe. */
function pinsChannel(action: Action): Id | null {
  switch (action.type) {
    case 'message:pinned':
    case 'message:deleted':
      return action.channelId;
    case 'message:updated':
      return action.message.pinnedAt ? action.message.channelId : null;
    default:
      return null;
  }
}

export function reducer(state: RealtimeState, action: Action): RealtimeState {
  const next = apply(state, action);
  const channelId = pinsChannel(action);
  return channelId ? { ...next, pinsVersion: { ...next.pinsVersion, [channelId]: (next.pinsVersion[channelId] ?? 0) + 1 } } : next;
}

function apply(state: RealtimeState, action: Action): RealtimeState {
  switch (action.type) {
    // Conexão, sessão, espaços, canais e navegação
    case 'connection':
      return session.connection(state, action);
    case 'session':
      return session.session(state, action);
    case 'space:created':
      return session.spaceCreated(state, action);
    case 'space:updated':
      return session.spaceUpdated(state, action);
    case 'space:deleted':
      return session.spaceDeleted(state, action);
    case 'channel:created':
      return session.channelCreated(state, action);
    case 'channel:updated':
      return session.channelUpdated(state, action);
    case 'channel:deleted':
      return session.channelDeleted(state, action);
    case 'dm:upsert':
      return session.dmUpsert(state, action);
    case 'dm:select':
      return session.dmSelect(state, action);
    case 'unread:bump':
      return session.unreadBump(state, action);
    case 'unread:clear':
      return session.unreadClear(state, action);
    case 'space:select':
      return session.spaceSelect(state, action);
    case 'space:snapshot':
      return session.spaceSnapshot(state, action);
    case 'channel:select':
      return session.channelSelect(state, action);
    case 'presence':
      return session.presence(state, action);
    case 'member:joined':
      return session.memberJoined(state, action);
    case 'mentions:update':
      return session.mentionsUpdate(state, action);

    // Mensagens
    case 'messages:history':
      return messages.messagesHistory(state, action);
    case 'messages:newer':
      return messages.messagesNewer(state, action);
    case 'messages:context':
      return messages.messagesContext(state, action);
    case 'focus:clear':
      return messages.focusClear(state);
    case 'history:loading':
      return messages.historyLoading(state, action);
    case 'message:updated':
      return messages.messageUpdated(state, action);
    case 'message:deleted':
      return messages.messageDeleted(state, action);
    case 'message:reactions':
      return messages.messageReactions(state, action);
    case 'message:pinned':
      return messages.messagePinned(state, action);
    case 'poll:updated':
      return messages.pollUpdated(state, action);
    case 'roulette:spun':
      return messages.rouletteSpun(state, action);
    case 'roulette:settled':
      return messages.rouletteSettled(state, action);
    case 'link:preview':
      return messages.linkPreview(state, action);
    case 'reply:start':
      return messages.replyStart(state, action);
    case 'reply:cancel':
      return messages.replyCancel(state);
    case 'message:new':
      return messages.messageNew(state, action);
    case 'typing':
      return messages.typing(state, action);

    // Chamada de voz, transmissões, câmeras, música e quadro de som
    case 'voice:update':
      return voice.voiceUpdate(state, action);
    case 'voice:self':
      return voice.voiceSelf(state, action);
    case 'speaking':
      return voice.speaking(state, action);
    case 'quality':
      return voice.quality(state, action);
    case 'music:state':
      return voice.musicState(state, action);
    case 'sounds:set':
      return voice.soundsSet(state, action);
    case 'screen:mine':
      return voice.screenMine(state, action);
    case 'screen:remote':
      return voice.screenRemote(state, action);
    case 'stage:open':
      return voice.stageOpen(state, action);
    case 'stage:close':
      return voice.stageClose(state, action);
    case 'stage:focus':
      return voice.stageFocus(state, action);
    case 'stage:layout':
      return voice.stageLayout(state, action);
    case 'camera:mine':
      return voice.cameraMine(state, action);
    case 'camera:remote':
      return voice.cameraRemote(state, action);
    case 'callView':
      return voice.callView(state, action);
  }
}
