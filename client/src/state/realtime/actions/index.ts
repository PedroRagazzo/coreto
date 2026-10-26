// As ações que os componentes chamam, reunidas de navigation.ts, messages.ts e voice.ts. Se faltar alguma de
// `RealtimeActions`, é erro de compilação aqui.

import type { ActionContext } from '../context';
import type { RealtimeActions } from '../types';
import { createMessageActions } from './messages';
import { createNavigation } from './navigation';
import { createVoiceActions } from './voice';

export function createActions(ctx: ActionContext): RealtimeActions {
  const navigation = createNavigation(ctx);
  return {
    ...navigation.actions,
    ...createMessageActions(ctx, navigation.loadHistory),
    ...createVoiceActions(ctx),
  };
}
