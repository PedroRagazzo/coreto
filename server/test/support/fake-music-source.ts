import { Readable } from 'node:stream';
import type { MusicRequest } from '../../src/music/links.js';
import type { NewTrack, Track } from '../../src/music/queue.js';
import { MusicError, type AudioHandle, type MusicSource } from '../../src/music/source.js';

/**
 * Um "YouTube" de mentira: resolve pedidos sem rede e entrega um tom de 440 Hz em PCM, tão rápido
 * quanto o bot consumir. Pedidos: "erro" não é achado; uma fonte "quebrada" falha ao tocar.
 */
export class FakeMusicSource implements MusicSource {
  readonly opened: string[] = [];

  async resolve(request: MusicRequest, requestedBy: string): Promise<NewTrack[]> {
    const make = (title: string, source = `fake:${title}`, durationSeconds = 4): NewTrack => ({
      requestedBy,
      title,
      artist: 'Banda de Teste',
      durationSeconds,
      source,
    });
    switch (request.kind) {
      case 'search':
        if (request.query === 'erro') throw new MusicError('Não achei nada para "erro".');
        return [make(request.query, request.query === 'quebrada' ? 'fake-quebrada' : undefined)];
      case 'youtube-video':
        return [make(`Vídeo ${request.id}`)];
      case 'youtube-playlist':
        return [make('Lista 1'), make('Lista 2'), make('Lista 3')];
      case 'spotify':
        return [make('Spotify 1'), make('Spotify 2')];
    }
  }

  open(track: Track): AudioHandle {
    this.opened.push(track.title);
    if (track.source === 'fake-quebrada') {
      const pcm = new Readable({ read() { this.push(null); } });
      return { pcm, stop() {}, finished: Promise.resolve({ bytes: 0, error: 'Esse vídeo é privado.' }) };
    }
    const totalFrames = (track.durationSeconds ?? 4) * 100;
    let produced = 0;
    let t = 0;
    let stopped = false;
    const pcm = new Readable({
      read() {
        if (stopped || produced >= totalFrames) return void this.push(null);
        // 100 ms por vez, como um ffmpeg entregaria.
        const chunk = Buffer.alloc(10 * 960);
        for (let i = 0; i < chunk.length / 2; i++) chunk.writeInt16LE(Math.round(8000 * Math.sin((2 * Math.PI * 440 * t++) / 48000)), i * 2);
        produced += 10;
        this.push(chunk);
      },
    });
    return {
      pcm,
      stop() {
        stopped = true;
        pcm.push(null);
      },
      finished: new Promise((resolve) => pcm.on('end', () => resolve({ bytes: produced * 960, error: null }))),
    };
  }
}
