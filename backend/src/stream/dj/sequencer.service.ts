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

type Item = { kind: 'song' | 'dj'; path: string };

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
    const encoder = this.encoder;
    if (this.stopping || !encoder) return;
    if (!item) {
      // A due DJ clip soft-failed; advance to a song on the next tick.
      setImmediate(() => void this.playNext());
      return;
    }

    if (item.kind === 'song') {
      this.logger.log(`▶  ${item.path.split('/').pop()}`);
    }

    const decoder = spawn(
      this.config.ffmpegPath,
      [
        '-hide_banner',
        '-loglevel',
        'error',
        '-re',
        '-i',
        item.path,
        '-vn',
        '-f',
        PCM.format,
        '-ar',
        String(this.config.sampleRate),
        '-ac',
        String(PCM.channels),
        'pipe:1',
      ],
      { stdio: ['ignore', 'pipe', 'pipe'] },
    );
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
   * DJ clip is inserted. Returns `null` when a due DJ clip fails (soft-fail),
   * signalling the caller to advance to the next song.
   */
  private async nextItem(): Promise<Item | null> {
    if (this.pendingDj) {
      this.pendingDj = false;
      const clip = await this.dj.nextInterstitial();
      return clip ? { kind: 'dj', path: clip } : null;
    }

    const path = this.songs[this.songIndex];
    this.songIndex = (this.songIndex + 1) % this.songs.length;
    this.songsSinceDj += 1;
    if (this.dj.enabled && this.songsSinceDj >= this.dj.everyNSongs) {
      this.pendingDj = true;
      this.songsSinceDj = 0;
    }
    return { kind: 'song', path };
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
