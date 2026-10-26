// O estado global em tempo real: o formato dele e o ponto de partida.

import type { ConnectionQuality } from '@shared/connection-quality';
import type {
  DirectConversation,
  Id,
  LinkPreview,
  MentionCount,
  Message,
  SoundClip,
  Space,
  SpaceSnapshot,
  UnreadCount,
  User,
  VoiceParticipant,
} from '@shared/models';
import type { MusicState } from '@shared/protocol';

export interface MyVoiceState {
  channelId: Id | null;
  channelName: string | null;
  spaceName: string | null;
  connecting: boolean;
  muted: boolean;
  deafened: boolean;
  canSpeak: boolean;
  /** Tem a permissão STREAM na sala (guardada ao entrar, vale mesmo em outro espaço). */
  canStream: boolean;
  /** Você está compartilhando a tela. */
  streaming: boolean;
  /** Sua câmera está ligada. */
  video: boolean;
  error: string | null;
}

export interface RealtimeState {
  connection: 'connecting' | 'ready' | 'disconnected';
  connectionError: string | null;
  me: User | null;
  spaces: Space[];
  /** `null` = área de mensagens diretas. */
  activeSpaceId: Id | null;
  activeChannelBySpace: Record<Id, Id>;
  snapshot: SpaceSnapshot | null;
  directs: Record<Id, DirectConversation>;
  activeDirectId: Id | null;
  /** espaço → os sons do quadro de som (carregados quando o quadro abre; o servidor avisa quando mudam) */
  sounds: Record<Id, SoundClip[]>;
  /** canal → contador que sobe quando as fixadas dele mudam (fixar, desafixar, editar ou apagar uma mensagem); o painel recarrega */
  pinsVersion: Record<Id, number>;
  /** Roletas que acabaram de girar ao vivo (mensagem → `true`): só elas animam; as que já tinham resultado aparecem paradas. */
  freshSpins: Record<Id, true>;
  /** link → o cartão de pré-visualização (`null` se a página não tem o que mostrar); ausente = ainda não pedido */
  linkPreviews: Record<string, LinkPreview | null>;
  /** canal de texto ou conversa direta → mensagens de outras pessoas ainda não lidas (some o que está zerado) */
  unread: Record<Id, UnreadCount>;
  users: Record<Id, User>;
  /** canal de texto ou conversa direta → mensagens */
  messages: Record<Id, Message[]>;
  /** canal ou conversa → usuário → instante (ms) em que o aviso de digitação expira */
  typing: Record<Id, Record<Id, number>>;
  /** Conversas cujo histórico já foi carregado até a primeira mensagem. */
  historyComplete: Record<Id, true>;
  /** Conversas buscando uma página de mensagens antigas agora. */
  loadingOlder: Record<Id, true>;
  voice: Record<Id, VoiceParticipant[]>;
  myVoice: MyVoiceState;
  /** canal → menções suas ainda não vistas (de todos os espaços) */
  mentions: Record<Id, MentionCount>;
  /** Quem está falando agora na sua chamada (medido localmente). */
  speaking: Record<Id, true>;
  /** A qualidade da conexão com cada pessoa da sua chamada, e a sua quando dá para saber (medido localmente). */
  quality: Record<Id, ConnectionQuality>;
  /** O bot de música na sua sala de voz, com a hora local em que o estado chegou (para andar a barra de progresso). */
  music: { state: MusicState; receivedAt: number } | null;
  /** Sua tela, enquanto você transmite (para a prévia). */
  myScreen: MediaStream | null;
  /** Telas que chegam de outras pessoas da chamada, por quem transmite. */
  screens: Record<Id, MediaStream>;
  /** A mensagem que a pessoa está respondendo no campo de texto; `null` se não está respondendo nenhuma. */
  replyingTo: Message | null;
  /** Transmissões abertas no painel central (a sua, para a prévia, e as de quem você assiste), na ordem em que abriram. */
  stages: Id[];
  /** A transmissão em destaque (a maior, e a que toca som); sempre uma das abertas, ou `null` se não há nenhuma. */
  focusedStage: Id | null;
  /** Com várias abertas: uma grande e as outras pequenas (`focus`), ou todas do mesmo tamanho (`grid`). */
  stageLayout: 'focus' | 'grid';
  /** Sua câmera, enquanto ligada (para o seu quadro no mosaico). */
  myCamera: MediaStream | null;
  /** Câmeras que chegam de outras pessoas da chamada. */
  cameras: Record<Id, MediaStream>;
  /** O painel central mostra o mosaico da chamada (em vez do chat). */
  callView: boolean;
  /** Conversas cuja lista não chega até a mensagem mais recente (depois de pular para uma antiga). */
  detached: Record<Id, true>;
  /** Mensagem para rolar até e destacar (resultado de busca). */
  focus: { channelId: Id; messageId: Id } | null;
}

export const IDLE_VOICE: MyVoiceState = {
  channelId: null,
  channelName: null,
  spaceName: null,
  connecting: false,
  muted: false,
  deafened: false,
  canSpeak: true,
  canStream: false,
  streaming: false,
  video: false,
  error: null,
};

export const initialState: RealtimeState = {
  connection: 'connecting',
  connectionError: null,
  me: null,
  spaces: [],
  activeSpaceId: null,
  activeChannelBySpace: {},
  snapshot: null,
  directs: {},
  activeDirectId: null,
  sounds: {},
  pinsVersion: {},
  freshSpins: {},
  linkPreviews: {},
  unread: {},
  users: {},
  messages: {},
  typing: {},
  historyComplete: {},
  loadingOlder: {},
  voice: {},
  myVoice: IDLE_VOICE,
  mentions: {},
  speaking: {},
  quality: {},
  music: null,
  myScreen: null,
  screens: {},
  replyingTo: null,
  stages: [],
  focusedStage: null,
  stageLayout: 'focus',
  myCamera: null,
  cameras: {},
  callView: false,
  detached: {},
  focus: null,
};
