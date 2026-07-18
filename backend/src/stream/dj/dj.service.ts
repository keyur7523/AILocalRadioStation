import { Inject, Injectable, Logger } from '@nestjs/common';
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
export class DjService {
  private readonly logger = new Logger(DjService.name);
  private readonly config: StreamConfig = loadStreamConfig();
  private static readonly SYNTH_TIMEOUT_MS = 15000;

  constructor(@Inject(TTS_SERVICE) private readonly tts: TtsService) {}

  get enabled(): boolean {
    return this.config.dj.enabled;
  }

  get everyNSongs(): number {
    return this.config.dj.everyNSongs;
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
}
