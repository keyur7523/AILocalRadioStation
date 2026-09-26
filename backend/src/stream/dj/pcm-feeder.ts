import type { Writable } from 'node:stream';

/**
 * Holds decoded audio for the encoder and hands it over one chunk at a time.
 *
 * Writing straight to the encoder's stdin looked like it kept a cushion, but a
 * pipe with several writes pending flushes them as a single batch: every write
 * callback, and `writableLength` itself, only move when the whole batch is done
 * — by which point the buffer is already empty. So the cushion drained to
 * nothing every cycle while the counters still read full, and a CPU spike at
 * that moment (a speech synthesis, say) starved the encoder into dead air.
 *
 * Keeping the cushion here, with exactly one write outstanding, means every
 * callback is real progress and {@link buffered} is the true amount waiting.
 */
export class PcmFeeder {
  private readonly queue: Buffer[] = [];
  private queued = 0;
  private writing = false;
  private closed = false;

  /**
   * @param sink      the encoder's stdin
   * @param lowWater  bytes below which `onLow` is called, so the producer can
   *                  top the queue back up long before it runs dry
   * @param onLow     called as the queue drains below `lowWater`
   */
  constructor(
    private readonly sink: Writable,
    private readonly lowWater: number,
    private readonly onLow: () => void,
  ) {}

  /** Bytes accepted here but not yet handed to the encoder. */
  get buffered(): number {
    return this.queued;
  }

  push(chunk: Buffer): void {
    if (this.closed) return;
    this.queue.push(chunk);
    this.queued += chunk.length;
    this.pump();
  }

  /** Stop feeding and drop anything queued — the encoder is going away. */
  close(): void {
    this.closed = true;
    this.queue.length = 0;
    this.queued = 0;
  }

  private pump(): void {
    if (this.writing || this.closed) return;
    const next = this.queue.shift();
    if (!next) return;
    this.writing = true;
    this.sink.write(next, (err) => {
      this.writing = false;
      if (this.closed) return;
      this.queued -= next.length;
      if (this.queued < this.lowWater) this.onLow();
      if (!err) this.pump();
    });
  }
}
