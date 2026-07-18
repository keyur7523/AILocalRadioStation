import {
  Injectable,
  Logger,
  OnModuleInit,
  OnModuleDestroy,
} from '@nestjs/common';
import { loadStreamConfig, type StreamConfig } from './stream.config';
import { SequencerService } from './dj/sequencer.service';

/**
 * Minimal contract for a connected listener. In practice this is an Express
 * `Response`, but the broadcaster only needs to push bytes and notice failure.
 */
export interface Listener {
  write(chunk: Buffer): boolean;
  destroyed?: boolean;
}

/**
 * The station's listener registry and fan-out.
 *
 * Audio production lives in {@link SequencerService} (the persistent encoder +
 * per-item decoder engine). The broadcaster just subscribes to that one MP3
 * stream and fans each chunk out to every `/stream` listener — so everyone
 * shares one playhead. This keeps the HTTP surface (`getStationInfo`,
 * `addListener`, `removeListener`) stable regardless of how audio is produced.
 */
@Injectable()
export class BroadcasterService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(BroadcasterService.name);
  private readonly config: StreamConfig = loadStreamConfig();
  private readonly listeners = new Set<Listener>();

  constructor(private readonly sequencer: SequencerService) {}

  onModuleInit(): void {
    this.sequencer.start({ onChunk: (chunk) => this.broadcast(chunk) });
  }

  onModuleDestroy(): void {
    // The sequencer tears down its own ffmpeg processes via its OnModuleDestroy.
    this.listeners.clear();
  }

  /** Station identity + live listener count, for the UI and metadata. */
  getStationInfo() {
    return {
      ...this.config.station,
      listeners: this.listeners.size,
      online: this.sequencer.online,
    };
  }

  /** Register a listener; they immediately start receiving the live stream. */
  addListener(listener: Listener): void {
    this.listeners.add(listener);
    this.logger.log(`Listener connected (${this.listeners.size} on air)`);
  }

  /** Drop a listener when their connection closes. */
  removeListener(listener: Listener): void {
    if (this.listeners.delete(listener)) {
      this.logger.log(`Listener left (${this.listeners.size} on air)`);
    }
  }

  /** Push one chunk to every listener, pruning any that have gone away. */
  private broadcast(chunk: Buffer): void {
    for (const listener of this.listeners) {
      if (listener.destroyed) {
        this.listeners.delete(listener);
        continue;
      }
      try {
        listener.write(chunk);
      } catch {
        this.listeners.delete(listener);
      }
    }
  }
}
