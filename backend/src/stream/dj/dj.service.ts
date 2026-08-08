import {
  Inject,
  Injectable,
  Logger,
  OnModuleInit,
  OnModuleDestroy,
} from '@nestjs/common';
import { loadStreamConfig, type StreamConfig } from '../stream.config';
import { StationConfigService } from '../station-config.service';
import { BaseTtsService } from '../tts/base-tts.service';
import { TTS_SERVICE, type TtsService } from '../tts/tts.interface';
import { buildBreakSegments, timeSegment } from './announcements';
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
    // The time line is the only part of a break that changes, and it's the same
    // text for every break in a minute — so pre-warming it keeps the hot path a
    // pure cache hit. (The track lines cache themselves after their first play.)
    void this.warm();
    this.scheduleWarm();
  }

  /**
   * The time we announce: now shifted forward so the spoken time matches the
   * listener's clock when they actually *hear* it. Three delays sit between
   * synthesis and the ear — the generate-ahead lead (the clip is made this long
   * before it plays), the server's own decode-ahead cushion (`bufferSec`), and
   * player/stream buffering (`timeOffsetSec`). Deriving it keeps the clock right
   * when any of those are tuned.
   */
  private announcedTime(): Date {
    return new Date(Date.now() + this.aheadMs);
  }

  /**
   * How far ahead of "now" the DJ speaks, in ms. Everything that delays a clip
   * between synthesis and the listener's ear. The warm timer keys off the same
   * figure, so it always pre-synthesizes the minute the next break will ask for.
   */
  private get aheadMs(): number {
    const { timeOffsetSec, prefetchLeadSec } = this.config.dj;
    return (timeOffsetSec + prefetchLeadSec + this.config.bufferSec) * 1000;
  }

  /**
   * The segments the DJ speaks at this break, in order. Split so each piece
   * caches on its own (see `announcements.ts`) — the track lines are identical
   * every time that track comes round, and only the time changes.
   */
  private buildSegments({ justPlayed, nextUp }: BreakInfo): string[] {
    const at = this.announcedTime();
    const zone = this.station.timeZone;
    if (!this.config.dj.announceTracks || (!justPlayed && !nextUp)) {
      return [formatTimePhrase(at, zone)];
    }
    return buildBreakSegments({
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
   * Produce the clips for the next break, in playback order. Each segment is
   * synthesized (or served from cache) separately, so a repeat of the same track
   * costs nothing and only the time line can ever need fresh synthesis.
   *
   * Returns `null` if the DJ is disabled or nothing could be produced — the
   * sequencer then just plays music. A segment that fails individually is
   * dropped, so a slow time line still leaves the track announcements intact.
   */
  async nextInterstitial(context: BreakInfo = {}): Promise<string[] | null> {
    if (!this.config.dj.enabled) return null;
    const segments = this.buildSegments(context);
    // Deliberately sequential: a speech engine can hold a few hundred MB while
    // it runs, and synthesizing every segment at once would multiply that on a
    // small host. Cached segments resolve instantly, so this costs nothing in
    // steady state.
    const kept: { text: string; path: string }[] = [];
    for (const text of segments) {
      try {
        const path = await withTimeout(
          this.tts.synthesize(text),
          this.config.dj.synthTimeoutMs,
        );
        kept.push({ text, path });
      } catch (err) {
        this.logger.warn(
          `DJ segment dropped ("${text}"): ${(err as Error).message}`,
        );
      }
    }
    if (kept.length === 0) {
      this.logger.warn('DJ break skipped — no segment could be synthesized');
      return null;
    }
    this.logger.log(`🎙  DJ: "${kept.map((s) => s.text).join(' ')}"`);
    return kept.map((s) => s.path);
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

  /** ms until the announced (look-ahead–adjusted) minute next rolls over. */
  private msToNextFlip(): number {
    // ms-into-the-wall-minute at which the announced minute flips. Must use the
    // same look-ahead as announcedTime(), or we warm the wrong minute and every
    // break landing in the mismatch window pays for a fresh synthesis.
    const flipAt = (60000 - (this.aheadMs % 60000)) % 60000;
    const nowInMin = Date.now() % 60000;
    const ms = (((flipAt - nowInMin) % 60000) + 60000) % 60000;
    // At the flip moment ms is 0; wait a full minute rather than tight-looping.
    return ms || 60000;
  }

  private async warm(): Promise<void> {
    // Warm exactly what the next break will ask for: the time line for the
    // upcoming template, or the plain time check when announcements are off.
    const at = this.announcedTime();
    const zone = this.station.timeZone;
    const phrase = this.config.dj.announceTracks
      ? timeSegment(formatClock(at, zone), this.breakCount)
      : formatTimePhrase(at, zone);
    if (phrase === this.warmedPhrase) return; // already cached this minute
    // Warming is an optimisation, never worth queueing behind real work: if a
    // break is already synthesizing, skip this minute rather than keep a slow
    // host busy. The break itself will synthesize what it needs.
    if (BaseTtsService.busy) {
      this.logger.debug('skipping cache warm — synthesis already busy');
      return;
    }
    try {
      await this.tts.synthesize(phrase);
      this.warmedPhrase = phrase;
      this.logger.log(`🔥 warmed cache for upcoming minute: "${phrase}"`);
    } catch (err) {
      this.logger.warn(`cache-warm failed: ${(err as Error).message}`);
    }
  }
}
