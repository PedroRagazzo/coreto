import type { VoiceParticipant } from '@shared/models';
import { HeadphoneOff, MicOff } from 'lucide-react';
import { useEffect, useRef } from 'react';
import { useRealtime } from '../state/realtime';
import { displayNameOf } from '../state/selectors';
import { Avatar } from './Avatar';
import { ConnectionIndicator } from './ConnectionIndicator';
import { useUserVolumeMenu } from './UserVolumeMenu';

export function useVideo(stream: MediaStream | null) {
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    const video = ref.current;
    if (!video) return;
    video.srcObject = stream;
    if (stream) video.play().catch(() => {});
  }, [stream]);
  return ref;
}

/** O quadro de uma pessoa na chamada: a câmera ou o avatar, com o anel de quem fala. `compact` é o das colunas estreitas. */
export function ParticipantTile({ participant, isMe, compact = false }: { participant: VoiceParticipant; isMe: boolean; compact?: boolean }) {
  const { state } = useRealtime();
  const { userId } = participant;
  const name = displayNameOf(state.snapshot, state.users, userId);
  const user = state.users[userId];
  const stream = participant.video ? (isMe ? state.myCamera : (state.cameras[userId] ?? null)) : null;
  const ref = useVideo(stream);
  const speaking = Boolean(state.speaking[userId]) && !participant.muted;
  const quality = state.quality[userId];
  const volumeMenu = useUserVolumeMenu();

  return (
    <li
      // Botão direito em alguém: volume só seu.
      onContextMenu={isMe ? undefined : (e) => volumeMenu.open(e, userId, name)}
      className={`relative flex aspect-video items-center justify-center overflow-hidden rounded-2xl bg-panel ring-2 transition-shadow ${
        speaking ? 'ring-online' : 'ring-transparent'
      }`}
    >
      {stream ? (
        <video
          ref={ref}
          autoPlay
          playsInline
          muted // o som vem pelo áudio da chamada, não pelo vídeo
          aria-label={`Câmera de ${name}`}
          // Sua própria câmera aparece espelhada, como num espelho.
          className={`h-full w-full object-cover ${isMe ? '-scale-x-100' : ''}`}
        />
      ) : (
        <span className={compact ? '-mt-3' : undefined}>
          <Avatar name={name} color={user?.avatarColor ?? '#555'} size={compact ? 'md' : 'lg'} speaking={speaking} />
        </span>
      )}
      <span className="absolute bottom-2 left-2 flex max-w-[calc(100%-1rem)] items-center gap-1.5 rounded bg-black/60 px-2 py-0.5 text-sm text-white">
        {participant.deafened ? (
          <HeadphoneOff size={14} aria-label="Som desativado" className="shrink-0 text-dnd" />
        ) : (
          participant.muted && <MicOff size={14} aria-label="Microfone desativado" className="shrink-0 text-dnd" />
        )}
        <span className="truncate">{isMe ? `${name} (você)` : name}</span>
        {speaking && <span className="sr-only">(falando)</span>}
        {quality && <ConnectionIndicator quality={quality} own={isMe} />}
      </span>
      {volumeMenu.menu}
    </li>
  );
}
