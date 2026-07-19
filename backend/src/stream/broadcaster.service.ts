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
  /** Bytes currently buffered in the socket (Node stream `writableLength`). */
  writableLength?: number;
  /** Close the connection (Node stream `end`). */
  end?(): void;
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

  /**
   * Max bytes we let queue in one listener's socket before dropping them. The
   * stream is live and shared — we can't slow it for one slow client — so a
   * listener that falls this far behind (~1MB ≈ 60s at 128kbps) is disconnected
   * to bound memory; they can reconnect and rejoin live.
   */
  private static readonly MAX_BACKLOG_BYTES = 1024 * 1024;

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

  /**
   * Push one chunk to every listener, pruning any that have gone away or fallen
   * too far behind. Ignoring socket backpressure would let a slow client's buffer
   * grow without bound, so a listener past {@link MAX_BACKLOG_BYTES} is dropped.
   */
  private broadcast(chunk: Buffer): void {
    for (const listener of this.listeners) {
      if (listener.destroyed) {
        this.listeners.delete(listener);
        continue;
      }
      if (
        (listener.writableLength ?? 0) > BroadcasterService.MAX_BACKLOG_BYTES
      ) {
        this.logger.warn('Listener too far behind; dropping to bound memory');
        this.listeners.delete(listener);
        try {
          listener.end?.();
        } catch {
          /* already gone */
        }
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
