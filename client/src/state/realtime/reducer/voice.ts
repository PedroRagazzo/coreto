// Chamada de voz, transmissões, câmeras, música e quadro de som.

import type { RealtimeState } from '../state';
import type { ActionOf } from '../types';
import { closeStage, withoutKey } from './helpers';

export function voiceUpdate(state: RealtimeState, action: ActionOf<'voice:update'>): RealtimeState {
  return { ...state, voice: { ...state.voice, [action.channelId]: action.participants } };
}

export function voiceSelf(state: RealtimeState, action: ActionOf<'voice:self'>): RealtimeState {
  const myVoice = { ...state.myVoice, ...action.patch };
  // Saiu da chamada: acabam a transmissão, as telas recebidas e o palco.
  if (myVoice.channelId === null && state.myVoice.channelId !== null) {
    return {
      ...state,
      myVoice: { ...myVoice, streaming: false, video: false },
      music: null,
      myScreen: null,
      screens: {},
      stages: [],
      focusedStage: null,
      myCamera: null,
      cameras: {},
      callView: false,
    };
  }
  return { ...state, myVoice };
}

export function speaking(state: RealtimeState, action: ActionOf<'speaking'>): RealtimeState {
  return { ...state, speaking: Object.fromEntries(action.userIds.map((id) => [id, true as const])) };
}

export function quality(state: RealtimeState, action: ActionOf<'quality'>): RealtimeState {
  return { ...state, quality: action.quality };
}

export function musicState(state: RealtimeState, action: ActionOf<'music:state'>): RealtimeState {
  return { ...state, music: action.state ? { state: action.state, receivedAt: Date.now() } : null };
}

export function soundsSet(state: RealtimeState, action: ActionOf<'sounds:set'>): RealtimeState {
  return { ...state, sounds: { ...state.sounds, [action.spaceId]: action.clips } };
}

export function screenMine(state: RealtimeState, action: ActionOf<'screen:mine'>): RealtimeState {
  return {
    ...state,
    myScreen: action.stream,
    myVoice: { ...state.myVoice, streaming: action.stream !== null },
    ...(action.stream === null && state.me ? closeStage(state, state.me.id) : {}),
  };
}

export function screenRemote(state: RealtimeState, action: ActionOf<'screen:remote'>): RealtimeState {
  return {
    ...state,
    screens: action.stream ? { ...state.screens, [action.userId]: action.stream } : withoutKey(state.screens, action.userId),
  };
}

export function stageOpen(state: RealtimeState, action: ActionOf<'stage:open'>): RealtimeState {
  // Abrir uma transmissão já aberta só a põe em destaque; uma nova entra no fim e também fica em destaque.
  return {
    ...state,
    stages: state.stages.includes(action.userId) ? state.stages : [...state.stages, action.userId],
    focusedStage: action.userId,
  };
}

export function stageClose(state: RealtimeState, action: ActionOf<'stage:close'>): RealtimeState {
  return { ...state, ...(action.userId === null ? { stages: [], focusedStage: null } : closeStage(state, action.userId)) };
}

export function stageFocus(state: RealtimeState, action: ActionOf<'stage:focus'>): RealtimeState {
  return state.stages.includes(action.userId) ? { ...state, focusedStage: action.userId } : state;
}

export function stageLayout(state: RealtimeState, action: ActionOf<'stage:layout'>): RealtimeState {
  return { ...state, stageLayout: action.layout };
}

export function cameraMine(state: RealtimeState, action: ActionOf<'camera:mine'>): RealtimeState {
  return { ...state, myCamera: action.stream, myVoice: { ...state.myVoice, video: action.stream !== null } };
}

export function cameraRemote(state: RealtimeState, action: ActionOf<'camera:remote'>): RealtimeState {
  return {
    ...state,
    cameras: action.stream ? { ...state.cameras, [action.userId]: action.stream } : withoutKey(state.cameras, action.userId),
  };
}

export function callView(state: RealtimeState, action: ActionOf<'callView'>): RealtimeState {
  return { ...state, callView: action.open };
}
