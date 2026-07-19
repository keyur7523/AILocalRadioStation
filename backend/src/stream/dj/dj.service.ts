import {
  Inject,
  Injectable,
  Logger,
  OnModuleInit,
  OnModuleDestroy,
} from '@nestjs/common';
import { loadStreamConfig, type StreamConfig } from '../stream.config';
import { TTS_SERVICE, type TtsService } from '../tts/tts.interface';
import { formatTimePhrase } from './time-announcer';

/** Race a promise against a timeout so a hung TTS never stalls the stream. */
function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`timed out after ${ms}ms`)),
      ms,
    );
    promise.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e) => {
        clearTimeout(timer);
        reject(e as Error);
      },
    );
  });
}

/**
 * Decides the DJ's between-song segments. For Phase II that's a single kind: a
 * spoken current-time check. It always **soft-fails** — any error yields `null`
 * so the sequencer skips the segment and keeps the music playing.
 */
@Injectable()
export class DjService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(DjService.name);
  private readonly config: StreamConfig = loadStreamConfig();
  private static readonly SYNTH_TIMEOUT_MS = 15000;

  private warmTimer?: NodeJS.Timeout;
  private warmedPhrase?: string;

  constructor(@Inject(TTS_SERVICE) private readonly tts: TtsService) {}

  /** Start keeping the current minute's clip warm in the TTS cache. */
  onModuleInit(): void {
    if (this.config.dj.enabled) this.scheduleWarm(0);
  }

  onModuleDestroy(): void {
    if (this.warmTimer) clearTimeout(this.warmTimer);
  }

  get enabled(): boolean {
    return this.config.dj.enabled;
  }

  get everyNSongs(): number {
    return this.config.dj.everyNSongs;
  }

  /** Whether the DJ talks over the song's tail (vs back-to-back after it). */
  get overlap(): boolean {
    return this.config.dj.overlap;
  }

  /**
   * Produce the next interstitial clip (a current-time announcement), generated
   * fresh so the spoken time is accurate. Returns the audio file path, or `null`
   * if the DJ is disabled or synthesis fails/times out.
   */
  async nextInterstitial(): Promise<string | null> {
    if (!this.config.dj.enabled) return null;
    const phrase = formatTimePhrase(new Date(), this.config.station.timeZone);
    try {
      const path = await withTimeout(
        this.tts.synthesize(phrase),
        DjService.SYNTH_TIMEOUT_MS,
      );
      this.logger.log(`🎙  DJ: "${phrase}"`);
      return path;
    } catch (err) {
      this.logger.warn(`DJ segment skipped: ${(err as Error).message}`);
      return null;
    }
  }

  /**
   * Pre-synthesize the current minute's time-check into the TTS cache so that
   * when a boundary needs it, it's already a cache hit — no synth on the hot
   * path, which is what caused the occasional pre-announcement lag on a busy /
   * cold host. Re-arms just after each minute rolls over.
   */
  private scheduleWarm(delayMs: number): void {
    this.warmTimer = setTimeout(() => {
      void this.warm();
      const msToNextMinute = 60000 - (Date.now() % 60000);
      this.scheduleWarm(msToNextMinute + 100);
    }, delayMs);
  }

  private async warm(): Promise<void> {
    const phrase = formatTimePhrase(new Date(), this.config.station.timeZone);
    if (phrase === this.warmedPhrase) return; // already cached this minute
    try {
      await this.tts.synthesize(phrase);
      this.warmedPhrase = phrase;
      this.logger.debug(`warmed clip: "${phrase}"`);
    } catch {
      /* ignore — the boundary path will retry / soft-fail */
    }
  }
}
