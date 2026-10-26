// As ações do reducer (o que muda no estado) e as ações que os componentes chamam (`RealtimeActions`).

import type { ConnectionQuality } from '@shared/connection-quality';
import type {
  Channel,
  DirectConversation,
  Id,
  LinkPreview,
  Member,
  MentionCount,
  Message,
  Poll,
  PresenceStatus,
  Reaction,
  Roulette,
  SoundClip,
  Space,
  SpaceSnapshot,
  UnreadCount,
  User,
  VoiceParticipant,
} from '@shared/models';
import type {
  Ack,
  ChannelCreatedPayload,
  CreateChannelRequest,
  DirectConversationPayload,
  MusicControl,
  MusicState,
  SearchRequest,
  SearchResult,
  SelectableStatus,
  UpdateChannelRequest,
} from '@shared/protocol';
import type { UploadHandle } from '../../lib/uploads';
import type { ScreenShareOptions, StreamStats } from '../../lib/voice';
import type { MyVoiceState, RealtimeState } from './state';

/** O que o reducer entende. Cada tipo é tratado por uma função em `reducer/`. */
export type Action =
  | { type: 'connection'; connection: RealtimeState['connection']; error?: string }
  | {
      type: 'session';
      user: User;
      spaces: Space[];
      directs: DirectConversation[];
      directUsers: User[];
      mentions: MentionCount[];
      unread: UnreadCount[];
    }
  | { type: 'unread:bump'; channelId: Id; spaceId: Id | null }
  | { type: 'unread:clear'; channelId: Id }
  | { type: 'space:created'; space: Space }
  | { type: 'space:updated'; space: Space }
  | { type: 'space:deleted'; spaceId: Id }
  | { type: 'channel:created'; payload: ChannelCreatedPayload }
  | { type: 'channel:updated'; channel: Channel }
  | { type: 'channel:deleted'; spaceId: Id; channelId: Id }
  | { type: 'dm:upsert'; payload: DirectConversationPayload }
  | { type: 'dm:select'; conversationId: Id }
  | { type: 'space:select'; spaceId: Id | null }
  | { type: 'space:snapshot'; snapshot: SpaceSnapshot }
  | { type: 'channel:select'; spaceId: Id; channelId: Id }
  | { type: 'messages:history'; channelId: Id; messages: Message[]; reachedStart: boolean; latest?: boolean }
  | { type: 'messages:newer'; channelId: Id; messages: Message[]; reachedEnd: boolean }
  | {
      type: 'messages:context';
      channelId: Id;
      messages: Message[];
      reachedStart: boolean;
      reachedEnd: boolean;
      focusId: Id;
    }
  | { type: 'focus:clear' }
  | { type: 'history:loading'; channelId: Id; loading: boolean }
  | { type: 'message:new'; message: Message }
  | { type: 'message:updated'; message: Message }
  | { type: 'message:deleted'; channelId: Id; messageId: Id }
  | { type: 'message:reactions'; channelId: Id; messageId: Id; reactions: Reaction[] }
  | { type: 'sounds:set'; spaceId: Id; clips: SoundClip[] }
  | { type: 'message:pinned'; channelId: Id; messageId: Id; pinnedAt: string | null; pinnedById: Id | null }
  | { type: 'poll:updated'; channelId: Id; messageId: Id; poll: Poll }
  | { type: 'roulette:spun'; channelId: Id; messageId: Id; roulette: Roulette }
  | { type: 'roulette:settled'; messageId: Id }
  | { type: 'link:preview'; url: string; preview: LinkPreview | null }
  | { type: 'reply:start'; message: Message }
  | { type: 'reply:cancel' }
  | { type: 'typing'; channelId: Id; userId: Id; until: number }
  | { type: 'presence'; userId: Id; status: PresenceStatus }
  | { type: 'member:joined'; member: Member; user: User }
  | { type: 'voice:update'; channelId: Id; participants: VoiceParticipant[] }
  | { type: 'voice:self'; patch: Partial<MyVoiceState> }
  | { type: 'mentions:update'; mention: MentionCount }
  | { type: 'speaking'; userIds: Id[] }
  | { type: 'quality'; quality: Record<Id, ConnectionQuality> }
  | { type: 'music:state'; state: MusicState | null }
  | { type: 'screen:mine'; stream: MediaStream | null }
  | { type: 'screen:remote'; userId: Id; stream: MediaStream | null }
  | { type: 'stage:open'; userId: Id }
  | { type: 'stage:close'; userId: Id | null }
  | { type: 'stage:focus'; userId: Id }
  | { type: 'stage:layout'; layout: 'focus' | 'grid' }
  | { type: 'camera:mine'; stream: MediaStream | null }
  | { type: 'camera:remote'; userId: Id; stream: MediaStream | null }
  | { type: 'callView'; open: boolean };

/** Uma ação específica, pelo tipo (para os tratadores do reducer). */
export type ActionOf<T extends Action['type']> = Extract<Action, { type: T }>;

export interface RealtimeActions {
  selectSpace(spaceId: Id | null): void;
  selectChannel(channelId: Id): void;
  /** Cria um espaço e abre ele. Resolve com erro ou `null`. */
  createSpace(name: string): Promise<string | null>;
  /** Renomeia o espaço aberto. Resolve com erro ou `null`. */
  renameSpace(name: string): Promise<string | null>;
  /** Exclui o espaço aberto com tudo dentro. Resolve com erro ou `null`. */
  deleteSpace(): Promise<string | null>;
  /** Cria um canal no espaço aberto e abre ele, se for de texto. Resolve com erro ou `null`. */
  createChannel(req: Omit<CreateChannelRequest, 'spaceId'>): Promise<string | null>;
  /** Altera nome, tópico ou categoria. Resolve com erro ou `null`. */
  updateChannel(req: UpdateChannelRequest): Promise<string | null>;
  /** Exclui o canal e as mensagens dele. Resolve com erro ou `null`. */
  deleteChannel(channelId: Id): Promise<string | null>;
  /** Abre (ou cria) a conversa direta com alguém. Resolve com erro ou `null`. */
  openDirect(userId: Id): Promise<string | null>;
  selectDirect(conversationId: Id): void;
  /** Envia para um canal de texto ou conversa direta, com anexos já enviados. Resolve com erro ou `null`. */
  sendMessage(targetId: Id, content: string, attachmentIds?: Id[], replyToId?: Id): Promise<string | null>;
  /** Carrega os sons do quadro de som do espaço para `state.sounds`. Resolve com o erro, ou `null`. */
  loadSounds(spaceId: Id): Promise<string | null>;
  /** Envia um som para o quadro de som do espaço. Resolve com o erro, ou `null`. */
  addSound(spaceId: Id, file: File, name: string, emoji: string | null): Promise<string | null>;
  removeSound(id: Id): Promise<string | null>;
  /** Toca o som para a chamada (e para você, se `monitor` > 0). Resolve com o erro, ou `null`. */
  playSound(clip: SoundClip, volume: number, monitor: number): Promise<string | null>;
  /** Corta os sons que estão tocando. */
  stopSounds(): void;
  /** Fixa a mensagem (ou desafixa). Resolve com o erro, ou `null`. */
  pinMessage(messageId: Id, pinned: boolean): Promise<string | null>;
  /** As mensagens fixadas do canal ou da conversa; ou o erro. */
  loadPins(channelId: Id): Promise<{ messages: Message[] } | { error: string }>;
  /** Cria uma enquete no canal ou conversa. Resolve com o erro, ou `null` quando deu certo (a mensagem chega pelo evento). */
  createPoll(targetId: Id, poll: { question: string; options: string[]; multiple: boolean }): Promise<string | null>;
  /** Cria uma roleta no canal ou conversa. Resolve com o erro, ou `null`. */
  createRoulette(targetId: Id, roulette: { title: string; options: string[] }): Promise<string | null>;
  /** Vota na opção (ou tira o voto). Resolve com o erro, ou `null`. */
  votePoll(messageId: Id, optionId: Id): Promise<string | null>;
  /** Encerra a enquete (quem criou, ou quem modera o canal). Resolve com o erro, ou `null`. */
  closePoll(messageId: Id): Promise<string | null>;
  /** Gira a roleta; o servidor sorteia e todo mundo vê o mesmo resultado. Resolve com o erro, ou `null`. */
  spinRoulette(messageId: Id): Promise<string | null>;
  /** Pede ao servidor o cartão do primeiro link da mensagem (uma vez por link); o resultado vai para `state.linkPreviews`. */
  requestLinkPreview(message: Message): void;
  /** Começa a responder a uma mensagem: o campo de texto mostra a quem e o envio leva a resposta. */
  startReply(message: Message): void;
  cancelReply(): void;
  /** Reage à mensagem com o emoji, ou tira a reação se já tinha. Resolve com erro ou `null`. */
  toggleReaction(messageId: Id, emoji: string): Promise<string | null>;
  /** Envia uma imagem ou um arquivo para anexar depois em `sendMessage`. */
  uploadFile(file: File, onProgress: (fraction: number) => void): UploadHandle;
  /** Busca a página anterior à mensagem mais antiga carregada. */
  loadOlder(targetId: Id): void;
  /** Edita uma mensagem sua. Resolve com erro ou `null`. */
  editMessage(messageId: Id, content: string): Promise<string | null>;
  /** Apaga uma mensagem (sua, ou de outros se você modera o canal). Resolve com erro ou `null`. */
  deleteMessage(messageId: Id): Promise<string | null>;
  notifyTyping(targetId: Id): void;
  joinVoice(channelId: Id): void;
  /** Abre o seletor de tela e começa a transmitir. Resolve com erro ou `null` (também se a pessoa cancelar). */
  startScreenShare(options: ScreenShareOptions): Promise<string | null>;
  stopScreenShare(): void;
  /** Pede uma música ao bot (link do YouTube/Spotify ou busca). Devolve o aviso para mostrar, ou o motivo da recusa. */
  musicPlay(input: string, next?: boolean): Promise<{ message: string } | { error: string }>;
  /** Controla o bot de música (pular, pausar, volume...). Devolve o motivo da recusa, ou `null`. */
  musicControl(request: MusicControl): Promise<string | null>;
  /** As opções da transmissão em andamento, ou `null` se você não está transmitindo. */
  screenOptions(): ScreenShareOptions | null;
  /** Muda a qualidade com a transmissão no ar; devolve as opções valendo, ou `null` se ela acabou. */
  updateScreenOptions(patch: Partial<Pick<ScreenShareOptions, 'height' | 'frameRate' | 'priority' | 'uploadMbps' | 'codec'>>): Promise<ScreenShareOptions | null>;
  /** Como a transmissão (sua ou a que você assiste) está indo agora; `null` se não há dados. */
  screenStats(userId: Id): Promise<StreamStats | null>;
  /** Miniatura da tela de quem está ao vivo (JPEG em data URL); `null` se ainda não há. */
  streamPreview(userId: Id): Promise<string | null>;
  /**
   * Assiste à transmissão de alguém, entrando no canal de voz dela se preciso.
   * Para você, abre a prévia. Falhas aparecem como aviso na barra de voz.
   */
  watchStream(userId: Id): void;
  /** Fecha uma transmissão aberta (a de `userId`, ou todas sem ele) e para de receber a tela de quem você assistia. */
  closeStage(userId?: Id): void;
  /** Põe uma das transmissões abertas em destaque (a maior, com som). */
  focusStage(userId: Id): void;
  /** Várias abertas: uma grande e as outras pequenas, ou todas do mesmo tamanho. */
  setStageLayout(layout: 'focus' | 'grid'): void;
  /** Liga ou desliga a câmera; falhas aparecem como aviso na barra de voz. */
  toggleCamera(): void;
  /** Entra no canal de voz (se ainda não estiver nele) e abre o mosaico da chamada. */
  openCall(channelId: Id): void;
  closeCall(): void;
  /** Abre a conversa da mensagem e rola até ela, carregando o histórico em volta. */
  jumpToMessage(message: Pick<Message, 'id'>): Promise<string | null>;
  /** Carrega as mensagens seguintes de uma lista parada no passado. */
  loadNewer(targetId: Id): void;
  /** Volta para as mensagens mais recentes (descarta a janela do passado). */
  jumpToPresent(targetId: Id): void;
  focusDone(): void;
  search(req: SearchRequest): Promise<Ack<SearchResult>>;
  leaveVoice(): void;
  toggleMute(): void;
  toggleDeafen(): void;
  dismissVoiceError(): void;
  setPresence(status: SelectableStatus): void;
}
