import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { spawn, type ChildProcessByStdio } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import type { Readable, Writable } from 'node:stream';
import {
  describeConfig,
  loadStreamConfig,
  type StreamConfig,
} from '../stream.config';
import { DjService } from './dj.service';
import { PCM } from './pcm.const';
import { buildTrackInfo, type TrackInfo } from './track-info';

export interface SequencerHooks {
  /** Called with each MP3 chunk off the persistent encoder. */
  onChunk: (chunk: Buffer) => void;
}

type Item =
  | { kind: 'song'; path: string; talkover?: string[] }
  /** One break, spoken as a sequence of separately-cached clips. */
  | { kind: 'dj'; paths: string[] }
  | { kind: 'gap' };

/**
 * Where a track's *audible* content starts and how long it runs, once dead air
 * at the head/tail is skipped. `duration: null` means "play through to the end".
 */
type Trim = { start: number; duration: number | null };

/** No trimming: play the file exactly as-is. */
const NO_TRIM: Trim = { start: 0, duration: null };

/** How to detect dead air, and how much of it to deliberately keep. */
type TrimOptions = {
  thresholdDb: number;
  minSilenceSec: number;
  /** Silence left at each edge so the cut doesn't sound abrupt. */
  padSec: number;
};

/**
 * The broadcast engine.
 *
 * One long-lived **encoder** ffmpeg reads raw PCM from stdin (paced at real time
 * with `-re`) and emits a single continuous MP3 (fanned out to listeners
 * unchanged — same shared playhead as Phase I). A **sequencer** plays items one
 * at a time: for each item it spawns a short-lived **decoder** ffmpeg that
 * decodes flat-out; its PCM is piped into the encoder's stdin with
 * `{ end: false }`, and the encoder's real-time consumption backpressures the
 * decoder to match. Between songs it injects a DJ clip. Swapping the PCM *source*
 * is invisible to the encoder, so items join seamlessly.
 *
 * **Generate-ahead:** the DJ clip needed at a boundary is synthesized *during*
 * the preceding song (a timer fires `prefetchLeadSec` before the song ends), so
 * the clip is ready when the boundary arrives and no silence gap forms while TTS
 * runs. The lead is kept small so a time-check stays accurate to the minute.
 */
@Injectable()
export class SequencerService implements OnModuleDestroy {
  private readonly logger = new Logger(SequencerService.name);
  private readonly config: StreamConfig = loadStreamConfig();

  private encoder?: ChildProcessByStdio<Writable, Readable, Readable>;
  private decoder?: ChildProcessByStdio<null, Readable, Readable>;
  private restartTimer?: NodeJS.Timeout;
  private stopping = false;

  private songs: string[] = [];
  private songIndex = 0;
  private songsSinceDj = 0;
  private pendingDj = false;
  /** Guards the inter-item silence so gaps and real items alternate. */
  private lastWasGap = true;

  /**
   * Per-file trim points, computed once per track and reused. Keyed by path;
   * holds the in-flight promise so concurrent lookups share one analysis.
   */
  private readonly trimCache = new Map<string, Promise<Trim>>();

  /** Per-file track metadata (title/artist), read once from the file's tags. */
  private readonly trackCache = new Map<string, Promise<TrackInfo | null>>();

  /** A DJ break's clips, synthesized ahead of the boundary that consumes them. */
  private djPrefetch?: Promise<string[] | null>;
  private prefetchTimer?: NodeJS.Timeout;
  /** The prefetch's resolved result, set once synthesis finishes. */
  private djReady?: string[] | null;

  private onChunk: (chunk: Buffer) => void = () => {};

  /** `bufferSec` expressed in bytes of the shared PCM format. */
  private get maxBufferBytes(): number {
    return Math.round(
      this.config.bufferSec * this.config.sampleRate * PCM.channels * 2,
    );
  }

  constructor(private readonly dj: DjService) {}

  start(hooks: SequencerHooks): void {
    this.onChunk = hooks.onChunk;
    this.stopping = false;
    this.logger.log('Starting broadcast engine — effective config:');
    for (const line of describeConfig(this.config))
      this.logger.log(`  ${line}`);
    this.launch();
  }

  onModuleDestroy(): void {
    this.stop();
  }

  /** Whether the encoder is currently up (for `/station` `online`). */
  get online(): boolean {
    return !!this.encoder && !this.encoder.killed;
  }

  /** Discover the rotation: every .mp3 in the media folder, in name order. */
  private resolvePlaylist(): string[] {
    const { mediaDir } = this.config;
    if (!existsSync(mediaDir)) {
      throw new Error(`Media directory not found: ${mediaDir}`);
    }
    const files = readdirSync(mediaDir)
      .filter((name) => name.toLowerCase().endsWith('.mp3'))
      .sort()
      .map((name) => join(mediaDir, name));
    if (files.length === 0) {
      throw new Error(`No .mp3 files found in ${mediaDir}`);
    }
    return files;
  }

  private launch(): void {
    if (this.stopping) return;

    try {
      this.songs = this.resolvePlaylist();
    } catch (err) {
      this.logger.error((err as Error).message);
      this.scheduleRestart();
      return;
    }
    this.logger.log(
      `Broadcasting ${this.songs.length} track(s) from ${this.config.mediaDir}` +
        (this.dj.enabled
          ? ` with DJ every ${this.dj.everyNSongs} song(s)`
          : ''),
    );
    for (const s of this.songs) this.logger.verbose(`  track: ${s}`);

    // Warm the trim analysis in the background so later songs never wait on it
    // (each track is analyzed once; the first song may briefly await its own).
    if (this.config.trim.enabled) {
      for (const s of this.songs) void this.trimFor(s);
    }

    // Persistent encoder: raw PCM stdin → continuous MP3 stdout. `-re` on the
    // PCM input makes THIS the single real-time pacer for the whole broadcast:
    // it consumes PCM at exactly wall-clock rate, and pipe backpressure throttles
    // the (unpaced) decoders to match. One pacer means no drift — decoders no
    // longer each carry `-re` (whose per-item startup burst made the stream run
    // ahead of real time when items are short).
    try {
      const encoder = spawn(
        this.config.ffmpegPath,
        [
          '-hide_banner',
          '-loglevel',
          'error',
          '-re',
          '-f',
          PCM.format,
          '-ar',
          String(this.config.sampleRate),
          '-ac',
          String(PCM.channels),
          '-i',
          'pipe:0',
          '-c:a',
          'libmp3lame',
          '-b:a',
          this.config.bitrate,
          '-f',
          'mp3',
          'pipe:1',
        ],
        { stdio: ['pipe', 'pipe', 'pipe'] },
      );
      this.encoder = encoder;
      this.logger.log(
        `Encoder up (pid ${encoder.pid}) — ${this.config.bitrate} MP3, ` +
          `single real-time pacer, ${this.config.bufferSec}s buffer`,
      );

      // As the encoder works through the cushion, let the current decoder top
      // it back up. Registered once here, since stdin lives as long as the
      // encoder while decoders come and go.
      encoder.stdin.on('drain', () => this.decoder?.stdout.resume());
      encoder.stdin.on('error', (err) =>
        this.logger.warn(`encoder stdin: ${err.message}`),
      );

      encoder.stdout.on('data', (chunk: Buffer) => this.onChunk(chunk));
      encoder.stderr.on('data', (chunk: Buffer) =>
        this.logger.warn(`encoder: ${chunk.toString().trim()}`),
      );
      encoder.on('error', (err) =>
        this.logger.error(`encoder spawn failed: ${err.message}`),
      );
      encoder.on('close', (code) => {
        if (this.stopping) return;
        this.logger.warn(`encoder exited (code ${code}); restarting`);
        this.killDecoder();
        this.clearPrefetch();
        this.encoder = undefined;
        this.scheduleRestart();
      });

      this.tick();
    } catch (err) {
      this.logger.error(
        `failed to start encoder: ${(err as Error).message}; retrying`,
      );
      this.scheduleRestart();
    }
  }

  /**
   * Run one play step, catching any unexpected error so the item loop never dies
   * silently. On a crash we kill the encoder — its `close` handler runs the clean
   * restart path (relaunch after a delay) — so the stream self-heals.
   */
  private tick(): void {
    this.playNext().catch((err) => {
      this.logger.error(`play loop crashed: ${(err as Error).message}`);
      if (this.encoder) this.encoder.kill('SIGKILL');
      else this.scheduleRestart();
    });
  }

  /** Play one item, then schedule the next. One decoder alive at a time. */
  private async playNext(): Promise<void> {
    if (this.stopping || !this.encoder) return;

    const item = await this.nextItem();
    if (this.stopping || !this.encoder) return;
    if (!item) {
      // A due DJ clip couldn't be produced (TTS failed); play a song instead.
      setImmediate(() => this.tick());
      return;
    }

    // Build the decoder command. A `gap` is real-time-paced silence between
    // items; a song with a `talkover` clip is played through a ducking
    // filtergraph (song + DJ voice over its tail); everything else is a plain
    // decode. talkoverArgs may await ffprobe, so re-check state after.
    let args: string[];
    if (item.kind === 'gap') {
      args = this.silenceDecoderArgs();
    } else if (item.kind === 'song') {
      // Songs skip their dead air; the analysis is cached so this is instant
      // after a track's first play (and pre-warmed at launch).
      const trim = await this.trimFor(item.path);
      args = item.talkover
        ? ((await this.talkoverArgs(item.path, item.talkover, trim)) ??
          this.plainDecoderArgs(item.path, trim))
        : this.plainDecoderArgs(item.path, trim);
    } else {
      // DJ break. A single clip gets the gentle speech trim; a multi-segment
      // break is concatenated as-is, since the short pause each clip already
      // carries is what separates the sentences.
      args =
        item.paths.length === 1
          ? this.plainDecoderArgs(
              item.paths[0],
              await this.trimForClip(item.paths[0]),
            )
          : this.concatDecoderArgs(item.paths);
    }

    const encoder = this.encoder;
    if (this.stopping || !encoder) return;

    if (item.kind === 'song') {
      const name = item.path.split('/').pop();
      this.logger.log(
        `▶  song: ${name}${item.talkover ? ' (DJ over tail)' : ''}`,
      );
    } else if (item.kind === 'dj') {
      this.logger.log(`🎙  DJ break on air (${item.paths.length} segment(s))`);
    } else if (item.kind === 'gap') {
      this.logger.debug(`···  gap ${this.config.dj.gapSec}s`);
    }

    const decoder = spawn(this.config.ffmpegPath, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    this.decoder = decoder;
    this.logger.verbose(`decode ${item.kind} started (pid ${decoder.pid})`);

    // Hand PCM to the encoder ourselves rather than piping, for two reasons:
    // we must never close the encoder's stdin (a pipe would, ending the whole
    // broadcast), and we want to run *ahead* of playback. The encoder consumes
    // at real time, so letting its stdin buffer fill to `bufferSec` gives that
    // many seconds of cushion — enough that a CPU spike (speech synthesis on a
    // small host) can't starve the stream into silence. The decoder is paused
    // once the cushion is full and resumes as the encoder drains it.
    decoder.stdout.on('data', (chunk: Buffer) => {
      encoder.stdin.write(chunk);
      if (encoder.stdin.writableLength >= this.maxBufferBytes) {
        decoder.stdout.pause();
      }
    });
    decoder.stderr.on('data', (chunk: Buffer) =>
      this.logger.debug(`decoder: ${chunk.toString().trim()}`),
    );

    // Generate-ahead: if the boundary at the end of this song will consume a DJ
    // clip (a back-to-back segment queued via pendingDj, or the next song is due
    // to be talked over), synthesize it during this song's playout so it's ready.
    if (
      item.kind === 'song' &&
      (this.pendingDj || this.nextSongIsOverlayDue())
    ) {
      this.schedulePrefetch(item.path);
    }

    let advanced = false;
    const advance = () => {
      if (advanced) return; // a decoder may emit both 'error' and 'close'
      advanced = true;
      this.clearPrefetchTimer();
      this.decoder = undefined;
      if (this.stopping) return;
      setImmediate(() => this.tick());
    };
    decoder.on('error', (err) => {
      const label =
        item.kind === 'gap'
          ? 'gap'
          : item.kind === 'dj'
            ? item.paths.join(' + ')
            : item.path;
      this.logger.warn(`decoder error (${label}): ${err.message}`);
      advance();
    });
    decoder.on('close', (code) => {
      if (code) this.logger.warn(`decoder ${item.kind} exited code ${code}`);
      else this.logger.verbose(`decode ${item.kind} finished`);
      advance();
    });
  }

  /**
   * Pick the next item. Songs cycle in order; after every `everyNSongs` songs a
   * DJ time-check is inserted — either as its own segment (`overlap` off, plays
   * back-to-back) or fused onto the upcoming song's tail (`overlap` on). Waits
   * for the clip so the time-check plays after every song; only when TTS
   * genuinely fails does the back-to-back segment return `null` (→ play a song).
   */
  private async nextItem(): Promise<Item | null> {
    // Insert a half-second (configurable) of silence between every item, so a
    // song, the time-check, and the next song are cleanly separated rather than
    // butting together (or overlapping). Alternates with real items.
    if (this.config.dj.gapSec > 0 && !this.lastWasGap) {
      this.lastWasGap = true;
      return { kind: 'gap' };
    }
    this.lastWasGap = false;

    // Back-to-back DJ segment queued from a previous song.
    if (this.pendingDj) {
      this.pendingDj = false;
      const clip = await this.takeDj();
      if (!clip) {
        this.logger.warn(
          '⤳  time-check unavailable (TTS failed) — playing song',
        );
        return null;
      }
      return { kind: 'dj', paths: clip };
    }

    const path = this.songs[this.songIndex];
    this.songIndex = (this.songIndex + 1) % this.songs.length;
    this.songsSinceDj += 1;

    const djDue = this.dj.enabled && this.songsSinceDj >= this.dj.everyNSongs;
    if (djDue) {
      this.songsSinceDj = 0;
      if (this.dj.overlap) {
        // II.3: talk over this song's tail. The clip was prefetched during the
        // previous song (see nextSongIsOverlayDue); wait for it so the talk-over
        // always plays (null only if TTS failed → song plays plain).
        const clip = await this.takeDj();
        return { kind: 'song', path, talkover: clip ?? undefined };
      }
      // II.2: the DJ speaks as its own segment after this song. The clip is
      // prefetched during this song and consumed by the pendingDj branch above.
      this.pendingDj = true;
    }
    return { kind: 'song', path };
  }

  /**
   * Whether the *next* song will be due for a DJ talk-over (overlap mode). Used
   * to decide, while a song is decoding, whether to prefetch the clip that the
   * next song will talk over. Mirrors the cadence check in {@link nextItem}: the
   * next song increments `songsSinceDj` to `songsSinceDj + 1`.
   */
  private nextSongIsOverlayDue(): boolean {
    return (
      this.dj.enabled &&
      this.dj.overlap &&
      this.songsSinceDj + 1 >= this.dj.everyNSongs
    );
  }

  /**
   * The DJ clip for this boundary, so a time-check plays after **every** song.
   * Prefers the generate-ahead result if it's ready; otherwise waits for the
   * in-flight synth; otherwise synthesizes now. Returns `null` only if TTS
   * genuinely fails. In steady state the clip is already warmed/prefetched
   * (`djReady` set), so this resolves instantly and never actually waits — the
   * brief wait only happens on a cold start before the cache warms.
   */
  private takeDj(): Promise<string[] | null> {
    if (this.djReady !== undefined) {
      const clip = this.djReady;
      this.djReady = undefined;
      this.djPrefetch = undefined;
      return Promise.resolve(clip);
    }
    // Not ready yet: wait for the in-flight prefetch, or synthesize now.
    const pending = this.djPrefetch ?? this.dj.nextInterstitial();
    this.djPrefetch = undefined;
    return pending;
  }

  /**
   * Schedule the next DJ clip to be synthesized `prefetchLeadSec` before `song`
   * ends, so it's ready at the boundary. The result is stashed in `djReady` the
   * moment synthesis resolves; {@link takeDj} consumes it.
   * If the song can't be probed or is shorter than the lead, we just don't get a
   * head start (the boundary may skip the check that cycle).
   */
  private schedulePrefetch(song: string): void {
    if (this.djPrefetch || this.djReady !== undefined) return;
    this.clearPrefetchTimer();
    this.audibleDurationSec(song)
      .then((dur) => {
        if (this.stopping || this.djPrefetch || this.djReady !== undefined) {
          return;
        }
        const delayMs = Math.max(
          0,
          (dur - this.config.dj.prefetchLeadSec) * 1000,
        );
        this.logger.verbose(
          `DJ prefetch scheduled in ${Math.round(delayMs)}ms (generate-ahead)`,
        );
        this.prefetchTimer = setTimeout(() => {
          if (this.stopping || this.djPrefetch) return;
          this.logger.verbose('DJ prefetch firing — synthesizing next clip');
          const pending = this.breakContext(song).then((ctx) =>
            this.dj.nextInterstitial(ctx),
          );
          this.djPrefetch = pending;
          void pending.then((clips) => {
            if (this.djPrefetch === pending) this.djReady = clips;
            // Analyze a single-clip break now, while the song still plays, so
            // the boundary doesn't wait on it.
            if (clips?.length === 1) void this.trimForClip(clips[0]);
          });
        }, delayMs);
      })
      .catch(() => {
        /* can't probe → no prefetch; boundary may skip the check this cycle */
      });
  }

  /**
   * What the DJ needs to fill this break: the track finishing now, and the one
   * queued behind it. `songIndex` has already advanced past `justPlayed`, so it
   * points at whatever plays after the break.
   */
  private async breakContext(
    justPlayedPath: string,
  ): Promise<{ justPlayed: TrackInfo | null; nextUp: TrackInfo | null }> {
    if (!this.config.dj.announceTracks) {
      return { justPlayed: null, nextUp: null };
    }
    const nextPath = this.songs[this.songIndex];
    const [justPlayed, nextUp] = await Promise.all([
      this.trackInfoFor(justPlayedPath),
      nextPath ? this.trackInfoFor(nextPath) : Promise.resolve(null),
    ]);
    return { justPlayed, nextUp };
  }

  private clearPrefetchTimer(): void {
    if (this.prefetchTimer) {
      clearTimeout(this.prefetchTimer);
      this.prefetchTimer = undefined;
    }
  }

  /** Drop any pending prefetch (timer + in-flight clip + resolved result). */
  private clearPrefetch(): void {
    this.clearPrefetchTimer();
    this.djPrefetch = undefined;
    this.djReady = undefined;
  }

  /**
   * `gapSec` seconds of silence, in the shared PCM contract. Generated flat-out;
   * the encoder's `-re` paces it to real wall-clock time like any other item.
   */
  private silenceDecoderArgs(): string[] {
    return [
      '-hide_banner',
      '-loglevel',
      'error',
      '-f',
      'lavfi',
      '-i',
      `anullsrc=r=${this.config.sampleRate}:cl=stereo`,
      '-t',
      String(this.config.dj.gapSec),
      '-f',
      PCM.format,
      '-ar',
      String(this.config.sampleRate),
      '-ac',
      String(PCM.channels),
      'pipe:1',
    ];
  }

  /**
   * Decode several clips as one continuous item, joined end to end. A DJ break
   * is spoken as separate segments (so each caches independently); concatenating
   * them in a single decode keeps the break a single seamless unit on the
   * stream, with the natural pause each clip already carries between sentences.
   */
  private concatDecoderArgs(paths: string[]): string[] {
    if (paths.length === 1) return this.plainDecoderArgs(paths[0]);
    const inputs = paths.flatMap((p) => ['-i', p]);
    const labels = paths.map((_, i) => `[${i}:a]`).join('');
    return [
      '-hide_banner',
      '-loglevel',
      'error',
      ...inputs,
      '-filter_complex',
      `${labels}concat=n=${paths.length}:v=0:a=1[out]`,
      '-map',
      '[out]',
      '-vn',
      '-f',
      PCM.format,
      '-ar',
      String(this.config.sampleRate),
      '-ac',
      String(PCM.channels),
      'pipe:1',
    ];
  }

  /**
   * Plain decode of one file to the shared PCM contract (encoder paces it).
   * `trim` skips dead air: `-ss` before `-i` seeks past the silent head, `-t`
   * caps the output so the silent tail is never emitted.
   */
  private plainDecoderArgs(path: string, trim: Trim = NO_TRIM): string[] {
    return [
      '-hide_banner',
      '-loglevel',
      'error',
      ...(trim.start > 0 ? ['-ss', trim.start.toFixed(3)] : []),
      '-i',
      path,
      ...(trim.duration !== null ? ['-t', trim.duration.toFixed(3)] : []),
      '-vn',
      '-f',
      PCM.format,
      '-ar',
      String(this.config.sampleRate),
      '-ac',
      String(PCM.channels),
      'pipe:1',
    ];
  }

  /**
   * Decode `song` with `clip` mixed over its tail: the voice is delayed to start
   * near the end, the music is ducked underneath it (sidechain compression), and
   * the voice is padded with silence to the song's length so the duck doesn't
   * truncate the song. Returns `null` if durations can't be probed (→ fall back
   * to a plain song decode).
   */
  private async talkoverArgs(
    song: string,
    clips: string[],
    trim: Trim = NO_TRIM,
  ): Promise<string[] | null> {
    try {
      const [rawSongDur, ...clipDurs] = await Promise.all([
        this.probeDurationSec(song),
        ...clips.map((c) => this.probeDurationSec(c)),
      ]);
      // Time the duck against the *audible* length, so the voice lands over the
      // real ending rather than over trimmed-away silence.
      const songDur = trim.duration ?? rawSongDur - trim.start;
      const clipDur = clipDurs.reduce((a, b) => a + b, 0);
      const sr = this.config.sampleRate;
      const startMs = Math.max(
        0,
        Math.round(
          (songDur - clipDur - this.config.dj.overlapTailPadSec) * 1000,
        ),
      );
      const layout = `aformat=sample_rates=${sr}:channel_layouts=stereo`;
      // The break's segments are joined into one voice track before ducking.
      const voiceLabels = clips.map((_, i) => `[${i + 1}:a]`).join('');
      const joinVoice =
        clips.length > 1
          ? `${voiceLabels}concat=n=${clips.length}:v=0:a=1[voice];`
          : '';
      const voice = clips.length > 1 ? '[voice]' : '[1:a]';
      const graph =
        `[0:a]${layout}[music];` +
        joinVoice +
        `${voice}${layout},adelay=${startMs}|${startMs},apad=whole_dur=${songDur},asplit=2[vkey][vmix];` +
        `[music][vkey]sidechaincompress=threshold=0.015:ratio=10:attack=20:release=350[ducked];` +
        `[ducked][vmix]amix=inputs=2:normalize=0:dropout_transition=0[out]`;
      return [
        '-hide_banner',
        '-loglevel',
        'error',
        ...(trim.start > 0 ? ['-ss', trim.start.toFixed(3)] : []),
        '-i',
        song,
        ...clips.flatMap((c) => ['-i', c]),
        ...(trim.duration !== null ? ['-t', trim.duration.toFixed(3)] : []),
        '-filter_complex',
        graph,
        '-map',
        '[out]',
        '-vn',
        '-f',
        PCM.format,
        '-ar',
        String(sr),
        '-ac',
        String(PCM.channels),
        'pipe:1',
      ];
    } catch (err) {
      this.logger.warn(
        `talk-over unavailable (${(err as Error).message}); playing song only`,
      );
      return null;
    }
  }

  /**
   * How long a track actually plays for, after trimming — what the DJ prefetch
   * timer must count against, or it would fire relative to the untrimmed end.
   */
  private async audibleDurationSec(path: string): Promise<number> {
    const [raw, trim] = await Promise.all([
      this.probeDurationSec(path),
      this.trimFor(path),
    ]);
    return trim.duration ?? raw - trim.start;
  }

  /**
   * Trim points for a track, analyzed once and cached (files are static, so the
   * result never changes). Soft-fails to {@link NO_TRIM} — a failed analysis
   * just means the track plays untrimmed, never that it stops playing.
   */
  private trimFor(path: string): Promise<Trim> {
    if (!this.config.trim.enabled) return Promise.resolve(NO_TRIM);
    return this.cachedTrim(path, {
      thresholdDb: this.config.trim.thresholdDb,
      minSilenceSec: this.config.trim.minSilenceSec,
      padSec: 0,
    });
  }

  /**
   * Trim points for a spoken DJ clip. Gentler than music on purpose: a stricter
   * threshold (so a soft speech onset isn't mistaken for silence) and a guard
   * pad left at each edge, so the delivery keeps a beat and doesn't sound
   * clipped. The surrounding `gapSec` still separates it from the music.
   */
  private trimForClip(path: string): Promise<Trim> {
    const { enabled, speech } = this.config.trim;
    if (!enabled || !speech.enabled) return Promise.resolve(NO_TRIM);
    return this.cachedTrim(path, {
      thresholdDb: speech.thresholdDb,
      minSilenceSec: this.config.trim.minSilenceSec,
      padSec: speech.padSec,
    });
  }

  /** Analyze once per file and reuse; soft-fails to playing the file whole. */
  private cachedTrim(path: string, opts: TrimOptions): Promise<Trim> {
    let pending = this.trimCache.get(path);
    if (!pending) {
      pending = this.analyzeTrim(path, opts).catch((err: Error) => {
        this.logger.warn(`trim analysis failed (${path}): ${err.message}`);
        return NO_TRIM;
      });
      this.trimCache.set(path, pending);
    }
    return pending;
  }

  /**
   * Find leading/trailing dead air with ffmpeg's `silencedetect`.
   *
   * Only silence touching the very start or very end is trimmed — a quiet
   * passage in the middle of a track is left alone. We analyze up front (rather
   * than filtering live) because trimming the tail in a filtergraph needs
   * `areverse`, which buffers the whole track and would stall the item boundary.
   */
  private async analyzeTrim(path: string, opts: TrimOptions): Promise<Trim> {
    const { thresholdDb, minSilenceSec, padSec } = opts;
    const duration = await this.probeDurationSec(path);
    const log = await this.runFfmpegStderr([
      '-hide_banner',
      '-nostats',
      '-i',
      path,
      '-af',
      `silencedetect=noise=${thresholdDb}dB:d=${minSilenceSec}`,
      '-f',
      'null',
      '-',
    ]);

    // Pair up "silence_start: X" / "silence_end: Y" lines in order.
    const periods: { start: number; end: number }[] = [];
    let open: number | null = null;
    for (const m of log.matchAll(/silence_(start|end):\s*(-?[\d.]+)/g)) {
      const value = Number.parseFloat(m[2]);
      if (!Number.isFinite(value)) continue;
      if (m[1] === 'start') open = value;
      else if (open !== null) {
        periods.push({ start: open, end: value });
        open = null;
      }
    }
    // A silence still open at EOF runs to the end of the file.
    if (open !== null) periods.push({ start: open, end: duration });

    const EDGE_TOL = 0.15; // treat "within 150ms of the edge" as touching it
    const first = periods[0];
    const last = periods[periods.length - 1];
    const rawStart = first && first.start <= EDGE_TOL ? first.end : 0;
    const rawTailStart =
      last && last.end >= duration - EDGE_TOL ? last.start : null;

    // Keep `padSec` of the silence at each edge so the cut never sounds abrupt
    // (speech especially needs a beat before and after the phrase).
    const start = Math.max(0, rawStart - padSec);
    const padded = rawTailStart === null ? null : rawTailStart + padSec;
    // If the pad reaches the end there's nothing left worth trimming.
    const tailStart =
      padded !== null && padded < duration - 0.02 ? padded : null;

    const audible = (tailStart ?? duration) - start;
    // Refuse a nonsensical trim (e.g. a near-silent file) — play it whole.
    if (
      !Number.isFinite(audible) ||
      audible < 0.3 ||
      audible < duration * 0.1
    ) {
      return NO_TRIM;
    }
    const trim: Trim = { start, duration: tailStart === null ? null : audible };
    if (start > 0 || tailStart !== null) {
      this.logger.log(
        `✂  trimmed ${path.split('/').pop()}: ` +
          `head ${start.toFixed(2)}s, tail ${(duration - (tailStart ?? duration)).toFixed(2)}s ` +
          `(${duration.toFixed(1)}s → ${audible.toFixed(1)}s)`,
      );
    }
    return trim;
  }

  /**
   * Title/artist for a track, read once from its embedded tags and cached.
   * Metadata is captured at import time (see `scripts/fetch-playlist.mjs`);
   * a file without tags falls back to its filename, and anything unusable
   * yields `null` so the DJ simply gives a plain time check instead.
   */
  private trackInfoFor(path: string): Promise<TrackInfo | null> {
    let pending = this.trackCache.get(path);
    if (!pending) {
      pending = this.readTags(path)
        .then((tags) => buildTrackInfo(tags, path))
        .catch((err: Error) => {
          this.logger.warn(`metadata read failed (${path}): ${err.message}`);
          return null;
        });
      this.trackCache.set(path, pending);
    }
    return pending;
  }

  /** Read a file's title/artist tags via ffprobe. */
  private readTags(path: string): Promise<{ title?: string; artist?: string }> {
    return new Promise((resolve, reject) => {
      const proc = spawn(
        this.config.ffprobePath,
        [
          '-v',
          'error',
          '-show_entries',
          'format_tags=title,artist',
          '-of',
          'json',
          path,
        ],
        { stdio: ['ignore', 'pipe', 'pipe'] },
      );
      let out = '';
      proc.stdout.on('data', (d: Buffer) => (out += d.toString()));
      proc.on('error', reject);
      proc.on('close', () => {
        try {
          const parsed = JSON.parse(out || '{}') as {
            format?: { tags?: { title?: string; artist?: string } };
          };
          resolve(parsed.format?.tags ?? {});
        } catch {
          resolve({});
        }
      });
    });
  }

  /** Run ffmpeg purely for its stderr analysis output (e.g. silencedetect). */
  private runFfmpegStderr(args: string[]): Promise<string> {
    return new Promise((resolve, reject) => {
      const proc = spawn(this.config.ffmpegPath, args, {
        stdio: ['ignore', 'ignore', 'pipe'],
      });
      let err = '';
      proc.stderr.on('data', (d: Buffer) => (err += d.toString()));
      proc.on('error', reject);
      proc.on('close', () => resolve(err));
    });
  }

  /** Probe a media file's duration in seconds via ffprobe. */
  private probeDurationSec(path: string): Promise<number> {
    return new Promise((resolve, reject) => {
      const proc = spawn(
        this.config.ffprobePath,
        [
          '-v',
          'error',
          '-show_entries',
          'format=duration',
          '-of',
          'csv=p=0',
          path,
        ],
        { stdio: ['ignore', 'pipe', 'pipe'] },
      );
      let out = '';
      let err = '';
      proc.stdout.on('data', (d: Buffer) => (out += d.toString()));
      proc.stderr.on('data', (d: Buffer) => (err += d.toString()));
      proc.on('error', reject);
      proc.on('close', (code) => {
        const seconds = Number.parseFloat(out.trim());
        if (code === 0 && Number.isFinite(seconds) && seconds > 0) {
          resolve(seconds);
        } else {
          reject(
            new Error(`ffprobe failed (${code}): ${err.trim() || out.trim()}`),
          );
        }
      });
    });
  }

  private killDecoder(): void {
    this.decoder?.kill('SIGKILL');
    this.decoder = undefined;
  }

  private scheduleRestart(): void {
    if (this.stopping) return;
    if (this.restartTimer) clearTimeout(this.restartTimer);
    this.restartTimer = setTimeout(
      () => this.launch(),
      this.config.restartDelayMs,
    );
  }

  private stop(): void {
    this.stopping = true;
    try {
      if (this.restartTimer) clearTimeout(this.restartTimer);
      this.clearPrefetch();
      this.killDecoder();
      this.encoder?.stdin.end();
      this.encoder?.kill('SIGTERM');
    } catch (err) {
      this.logger.warn(`teardown error: ${(err as Error).message}`);
    }
    this.encoder = undefined;
  }
}
