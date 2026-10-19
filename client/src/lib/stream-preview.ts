// Miniatura da tela compartilhada para a prévia na lista da sala: de tempos em tempos tira uma
// foto pequena do vídeo (JPEG) e entrega para ser enviada ao servidor. A imagem só viaja por
// esse caminho (nunca pelo vídeo da chamada), então dá para ver a tela antes de assistir.

const MAX_WIDTH = 320;
const MAX_HEIGHT = 180;
const QUALITY = 0.6;
/** O servidor aceita no máximo uma a cada 2 s; 8 s mantém a prévia fresca gastando quase nada. */
const INTERVAL_MS = 8000;
const FIRST_SHOT_MS = 1200;

export class PreviewCapture {
  private readonly video = document.createElement('video');
  private readonly canvas = document.createElement('canvas');
  private timer: ReturnType<typeof setTimeout> | null = null;
  private stopped = false;

  constructor(
    stream: MediaStream,
    private readonly send: (image: string) => void,
  ) {
    this.video.muted = true;
    this.video.playsInline = true;
    this.video.srcObject = new MediaStream(stream.getVideoTracks());
    void this.video.play().catch(() => {});
    this.timer = setTimeout(() => this.tick(), FIRST_SHOT_MS);
  }

  private tick(): void {
    if (this.stopped) return;
    const image = this.snapshot();
    if (image) this.send(image);
    this.timer = setTimeout(() => this.tick(), INTERVAL_MS);
  }

  /** `null` enquanto o vídeo ainda não tem imagem. */
  private snapshot(): string | null {
    const { videoWidth, videoHeight } = this.video;
    if (!videoWidth || !videoHeight) return null;
    const scale = Math.min(MAX_WIDTH / videoWidth, MAX_HEIGHT / videoHeight, 1);
    this.canvas.width = Math.max(1, Math.round(videoWidth * scale));
    this.canvas.height = Math.max(1, Math.round(videoHeight * scale));
    const context = this.canvas.getContext('2d');
    if (!context) return null;
    context.drawImage(this.video, 0, 0, this.canvas.width, this.canvas.height);
    return this.canvas.toDataURL('image/jpeg', QUALITY);
  }

  stop(): void {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    this.video.pause();
    this.video.srcObject = null;
  }
}
