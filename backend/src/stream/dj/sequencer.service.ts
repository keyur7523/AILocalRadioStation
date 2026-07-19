import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { spawn, type ChildProcessByStdio } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import type { Readable, Writable } from 'node:stream';
import { loadStreamConfig, type StreamConfig } from '../stream.config';
import { DjService } from './dj.service';
import { PCM } from './pcm.const';

export interface SequencerHooks {
  /** Called with each MP3 chunk off the persistent encoder. */
  onChunk: (chunk: Buffer) => void;
}

type Item =
  | { kind: 'song'; path: string; talkover?: string }
  | { kind: 'dj'; path: string }
  | { kind: 'gap' };

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

  /** A DJ clip synthesized ahead of the boundary that will consume it. */
  private djPrefetch?: Promise<string | null>;
  private prefetchTimer?: NodeJS.Timeout;
  /** The prefetch's resolved result, set once synthesis finishes (path/null). */
  private djReady?: string | null;

  private onChunk: (chunk: Buffer) => void = () => {};

  constructor(private readonly dj: DjService) {}

  start(hooks: SequencerHooks): void {
    this.onChunk = hooks.onChunk;
    this.stopping = false;
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

    // Persistent encoder: raw PCM stdin → continuous MP3 stdout. `-re` on the
    // PCM input makes THIS the single real-time pacer for the whole broadcast:
    // it consumes PCM at exactly wall-clock rate, and pipe backpressure throttles
    // the (unpaced) decoders to match. One pacer means no drift — decoders no
    // longer each carry `-re` (whose per-item startup burst made the stream run
    // ahead of real time when items are short).
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

    void this.playNext();
  }

  /** Play one item, then schedule the next. One decoder alive at a time. */
  private async playNext(): Promise<void> {
    if (this.stopping || !this.encoder) return;

    const item = this.nextItem();
    if (this.stopping || !this.encoder) return;
    if (!item) {
      // A due DJ clip wasn't ready (skipped); advance to a song on the next tick.
      setImmediate(() => void this.playNext());
      return;
    }

    // Build the decoder command. A `gap` is real-time-paced silence between
    // items; a song with a `talkover` clip is played through a ducking
    // filtergraph (song + DJ voice over its tail); everything else is a plain
    // decode. talkoverArgs may await ffprobe, so re-check state after.
    let args: string[];
    if (item.kind === 'gap') {
      args = this.silenceDecoderArgs();
    } else if (item.kind === 'song' && item.talkover) {
      args =
        (await this.talkoverArgs(item.path, item.talkover)) ??
        this.plainDecoderArgs(item.path);
    } else {
      args = this.plainDecoderArgs(item.path);
    }

    const encoder = this.encoder;
    if (this.stopping || !encoder) return;

    if (item.kind === 'song') {
      const name = item.path.split('/').pop();
      this.logger.log(`▶  ${name}${item.talkover ? ' (DJ over tail)' : ''}`);
    } else if (item.kind === 'gap') {
      this.logger.debug(`··· gap ${this.config.dj.gapSec}s`);
    }

    const decoder = spawn(this.config.ffmpegPath, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    this.decoder = decoder;

    // { end: false } is load-bearing: never close the encoder's stdin here.
    decoder.stdout.pipe(encoder.stdin, { end: false });
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
      setImmediate(() => void this.playNext());
    };
    decoder.on('error', (err) => {
      const label = item.kind === 'gap' ? 'gap' : item.path;
      this.logger.warn(`decoder error (${label}): ${err.message}`);
      advance();
    });
    decoder.on('close', (code) => {
      if (code) this.logger.warn(`decoder ${item.kind} exited code ${code}`);
      advance();
    });
  }

  /**
   * Pick the next item. Songs cycle in order; after every `everyNSongs` songs a
   * DJ time-check is inserted — either as its own segment (`overlap` off, plays
   * back-to-back) or fused onto the upcoming song's tail (`overlap` on). Never
   * blocks on TTS: returns `null` when a due back-to-back clip isn't ready yet
   * (→ skip to a song), so the music never stalls waiting for synthesis.
   */
  private nextItem(): Item | null {
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
      const clip = this.takeReadyDj();
      return clip ? { kind: 'dj', path: clip } : null;
    }

    const path = this.songs[this.songIndex];
    this.songIndex = (this.songIndex + 1) % this.songs.length;
    this.songsSinceDj += 1;

    const djDue = this.dj.enabled && this.songsSinceDj >= this.dj.everyNSongs;
    if (djDue) {
      this.songsSinceDj = 0;
      if (this.dj.overlap) {
        // II.3: talk over this song's tail. The clip was prefetched during the
        // previous song (see nextSongIsOverlayDue); takeReadyDj returns it if
        // ready, else undefined → the song just plays without a talk-over.
        const clip = this.takeReadyDj();
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
   * The prefetched DJ clip **only if synthesis already finished**, else `null`.
   * Never blocks: if the clip isn't ready at the boundary (cold host / CPU
   * spike), we skip the time-check this cycle rather than stalling the music
   * while TTS finishes — the pause-before-the-time is worse than a missed check.
   * With the per-minute cache warming in {@link DjService}, the prefetch is
   * almost always a cache hit, so this rarely skips.
   */
  private takeReadyDj(): string | null {
    const clip = this.djReady ?? null;
    this.djReady = undefined;
    this.djPrefetch = undefined; // discard any still-in-flight synth
    return clip;
  }

  /**
   * Schedule the next DJ clip to be synthesized `prefetchLeadSec` before `song`
   * ends, so it's ready at the boundary. The result is stashed in `djReady` the
   * moment synthesis resolves; {@link takeReadyDj} consumes it without blocking.
   * If the song can't be probed or is shorter than the lead, we just don't get a
   * head start (the boundary may skip the check that cycle).
   */
  private schedulePrefetch(song: string): void {
    if (this.djPrefetch || this.djReady !== undefined) return;
    this.clearPrefetchTimer();
    this.probeDurationSec(song)
      .then((dur) => {
        if (this.stopping || this.djPrefetch || this.djReady !== undefined) {
          return;
        }
        const delayMs = Math.max(
          0,
          (dur - this.config.dj.prefetchLeadSec) * 1000,
        );
        this.prefetchTimer = setTimeout(() => {
          if (this.stopping || this.djPrefetch) return;
          const pending = this.dj.nextInterstitial();
          this.djPrefetch = pending;
          void pending.then((clip) => {
            if (this.djPrefetch === pending) this.djReady = clip;
          });
        }, delayMs);
      })
      .catch(() => {
        /* can't probe → no prefetch; boundary may skip the check this cycle */
      });
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

  /** Plain decode of one file to the shared PCM contract (encoder paces it). */
  private plainDecoderArgs(path: string): string[] {
    return [
      '-hide_banner',
      '-loglevel',
      'error',
      '-i',
      path,
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
    clip: string,
  ): Promise<string[] | null> {
    try {
      const [songDur, clipDur] = await Promise.all([
        this.probeDurationSec(song),
        this.probeDurationSec(clip),
      ]);
      const sr = this.config.sampleRate;
      const startMs = Math.max(
        0,
        Math.round(
          (songDur - clipDur - this.config.dj.overlapTailPadSec) * 1000,
        ),
      );
      const layout = `aformat=sample_rates=${sr}:channel_layouts=stereo`;
      const graph =
        `[0:a]${layout}[music];` +
        `[1:a]${layout},adelay=${startMs}|${startMs},apad=whole_dur=${songDur},asplit=2[vkey][vmix];` +
        `[music][vkey]sidechaincompress=threshold=0.015:ratio=10:attack=20:release=350[ducked];` +
        `[ducked][vmix]amix=inputs=2:normalize=0:dropout_transition=0[out]`;
      return [
        '-hide_banner',
        '-loglevel',
        'error',
        '-i',
        song,
        '-i',
        clip,
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
    if (this.restartTimer) clearTimeout(this.restartTimer);
    this.clearPrefetch();
    this.killDecoder();
    this.encoder?.stdin.end();
    this.encoder?.kill('SIGTERM');
    this.encoder = undefined;
  }
}
