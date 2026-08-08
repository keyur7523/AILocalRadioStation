import {
  Inject,
  Injectable,
  Logger,
  OnModuleInit,
  OnModuleDestroy,
} from '@nestjs/common';
import { loadStreamConfig, type StreamConfig } from '../stream.config';
import { StationConfigService } from '../station-config.service';
import { TTS_SERVICE, type TtsService } from '../tts/tts.interface';
import { buildBreakPhrase } from './announcements';
import { formatClock, formatTimePhrase } from './time-announcer';
import type { TrackInfo } from './track-info';

/** What the sequencer knows about the break it's asking the DJ to fill. */
export interface BreakInfo {
  justPlayed?: TrackInfo | null;
  nextUp?: TrackInfo | null;
}

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
  /** Rotates announcement templates so consecutive breaks aren't identical. */
  private breakCount = 0;

  constructor(
    @Inject(TTS_SERVICE) private readonly tts: TtsService,
    private readonly station: StationConfigService,
  ) {}

  /** Start keeping the current (offset-adjusted) minute's clip warm. */
  onModuleInit(): void {
    if (!this.config.dj.enabled) {
      this.logger.log('DJ disabled — songs only');
      return;
    }
    const { announceTracks, timeOffsetSec } = this.config.dj;
    this.logger.log(
      `DJ enabled — ${announceTracks ? 'track announcements + time' : 'time checks'} ` +
        `(TZ=${this.station.timeZone}, time-offset ${timeOffsetSec}s)`,
    );
    // Warming only pays off when every break says the same thing. With track
    // announcements the phrase differs per break, so pre-synthesizing a
    // time-only clip would just burn CPU; generate-ahead covers that case.
    if (!announceTracks) {
      void this.warm();
      this.scheduleWarm();
    }
  }

  /**
   * The time we announce: now shifted forward so the spoken time matches the
   * listener's clock when they actually *hear* it. Two delays sit between
   * synthesis and the ear — the generate-ahead lead (the clip is made this long
   * before it plays) and player/stream buffering (`timeOffsetSec`).
   */
  private announcedTime(): Date {
    const { timeOffsetSec, prefetchLeadSec } = this.config.dj;
    return new Date(Date.now() + (timeOffsetSec + prefetchLeadSec) * 1000);
  }

  /**
   * What the DJ says at this break: a full back-announce + time + tease when the
   * tracks carry metadata, or the plain time check otherwise.
   */
  private buildPhrase({ justPlayed, nextUp }: BreakInfo): string {
    const at = this.announcedTime();
    const zone = this.station.timeZone;
    if (!this.config.dj.announceTracks || (!justPlayed && !nextUp)) {
      return formatTimePhrase(at, zone);
    }
    return buildBreakPhrase({
      justPlayed,
      nextUp,
      clock: formatClock(at, zone),
      seed: this.breakCount++,
    });
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
  async nextInterstitial(context: BreakInfo = {}): Promise<string | null> {
    if (!this.config.dj.enabled) return null;
    const phrase = this.buildPhrase(context);
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
   * Pre-synthesize the announced-minute time-check into the TTS cache so that
   * when a boundary needs it, it's already a cache hit — no synth on the hot
   * path. Re-arms at each **announced-minute** flip, which (with the offset)
   * lands `timeOffsetSec` before each wall-clock minute.
   */
  private scheduleWarm(): void {
    this.warmTimer = setTimeout(() => {
      void this.warm();
      this.scheduleWarm();
    }, this.msToNextFlip());
  }

  /** ms until the announced (offset-adjusted) minute next rolls over. */
  private msToNextFlip(): number {
    const offsetMs = this.config.dj.timeOffsetSec * 1000;
    // ms-into-the-wall-minute at which the announced minute flips.
    const flipAt = (60000 - (offsetMs % 60000)) % 60000;
    const nowInMin = Date.now() % 60000;
    const ms = (((flipAt - nowInMin) % 60000) + 60000) % 60000;
    // At the flip moment ms is 0; wait a full minute rather than tight-looping.
    return ms || 60000;
  }

  private async warm(): Promise<void> {
    const phrase = formatTimePhrase(
      this.announcedTime(),
      this.station.timeZone,
    );
    if (phrase === this.warmedPhrase) return; // already cached this minute
    try {
      await this.tts.synthesize(phrase);
      this.warmedPhrase = phrase;
      this.logger.log(`🔥 warmed cache for upcoming minute: "${phrase}"`);
    } catch (err) {
      this.logger.warn(`cache-warm failed: ${(err as Error).message}`);
    }
  }
}
