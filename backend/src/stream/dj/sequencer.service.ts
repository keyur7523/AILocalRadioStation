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

type Item = { kind: 'song' | 'dj'; path: string; talkover?: string };

/**
 * The broadcast engine.
 *
 * One long-lived **encoder** ffmpeg reads raw PCM from stdin and emits a single
 * continuous MP3 (fanned out to listeners unchanged — same shared playhead as
 * Phase I). A **sequencer** plays items one at a time: for each item it spawns a
 * short-lived **decoder** ffmpeg (`-re` real-time paced) whose PCM is piped into
 * the encoder's stdin with `{ end: false }`. Between songs it injects a DJ clip.
 * Swapping the PCM *source* is invisible to the encoder, so items join seamlessly.
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
        (this.dj.enabled ? ` with DJ every ${this.dj.everyNSongs} song(s)` : ''),
    );

    // Persistent encoder: raw PCM stdin → continuous MP3 stdout. No -re: it
    // drains PCM as fast as the (real-time-paced) decoder supplies it.
    const encoder = spawn(
      this.config.ffmpegPath,
      [
        '-hide_banner',
        '-loglevel',
        'error',
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
      this.encoder = undefined;
      this.scheduleRestart();
    });

    void this.playNext();
  }

  /** Play one item, then schedule the next. One decoder alive at a time. */
  private async playNext(): Promise<void> {
    if (this.stopping || !this.encoder) return;

    const item = await this.nextItem();
    if (this.stopping || !this.encoder) return;
    if (!item) {
      // A due DJ clip soft-failed; advance to a song on the next tick.
      setImmediate(() => void this.playNext());
      return;
    }

    // Build the decoder command. A song with a `talkover` clip is played through
    // a ducking filtergraph (song + DJ voice over its tail); everything else is
    // a plain decode. talkoverArgs may await ffprobe, so re-check state after.
    let args: string[];
    if (item.kind === 'song' && item.talkover) {
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

    let advanced = false;
    const advance = () => {
      if (advanced) return; // a decoder may emit both 'error' and 'close'
      advanced = true;
      this.decoder = undefined;
      if (this.stopping) return;
      setImmediate(() => void this.playNext());
    };
    decoder.on('error', (err) => {
      this.logger.warn(`decoder error (${item.path}): ${err.message}`);
      advance();
    });
    decoder.on('close', () => advance());
  }

  /**
   * Pick the next item. Songs cycle in order; after every `everyNSongs` songs a
   * DJ time-check is inserted — either as its own segment (`overlap` off, plays
   * back-to-back) or fused onto the upcoming song's tail (`overlap` on). Returns
   * `null` when a due back-to-back DJ clip fails (soft-fail → play a song).
   */
  private async nextItem(): Promise<Item | null> {
    // Back-to-back DJ segment queued from a previous song.
    if (this.pendingDj) {
      this.pendingDj = false;
      const clip = await this.dj.nextInterstitial();
      return clip ? { kind: 'dj', path: clip } : null;
    }

    const path = this.songs[this.songIndex];
    this.songIndex = (this.songIndex + 1) % this.songs.length;
    this.songsSinceDj += 1;

    const djDue = this.dj.enabled && this.songsSinceDj >= this.dj.everyNSongs;
    if (djDue) {
      this.songsSinceDj = 0;
      if (this.dj.overlap) {
        // II.3: generate the clip now and talk over this song's tail. A
        // soft-fail (null) just means the song plays without a talk-over.
        const clip = await this.dj.nextInterstitial();
        return { kind: 'song', path, talkover: clip ?? undefined };
      }
      // II.2: the DJ speaks as its own segment after this song.
      this.pendingDj = true;
    }
    return { kind: 'song', path };
  }

  /** Plain real-time decode of one file to the shared PCM contract. */
  private plainDecoderArgs(path: string): string[] {
    return [
      '-hide_banner',
      '-loglevel',
      'error',
      '-re',
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
        '-re',
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
          reject(new Error(`ffprobe failed (${code}): ${err.trim() || out.trim()}`));
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
    this.killDecoder();
    this.encoder?.stdin.end();
    this.encoder?.kill('SIGTERM');
    this.encoder = undefined;
  }
}
