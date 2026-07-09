import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { spawn, type ChildProcessByStdio } from 'node:child_process';
import { existsSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Readable } from 'node:stream';
import { loadStreamConfig, type StreamConfig } from './stream.config';

/**
 * Minimal contract for a connected listener. In practice this is an Express
 * `Response`, but the broadcaster only needs to push bytes and notice failure.
 */
export interface Listener {
  write(chunk: Buffer): boolean;
  destroyed?: boolean;
}

/**
 * The heart of the station.
 *
 * A single, long-lived ffmpeg process concatenates the media folder on an
 * infinite loop and emits one continuous, real-time MP3 byte stream. Every
 * listener subscribes to that *same* stream, so everyone shares one playhead —
 * tuning in mid-song, exactly like a real radio dial. This is what makes the
 * broadcast shared rather than per-listener.
 */
@Injectable()
export class BroadcasterService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(BroadcasterService.name);
  private readonly config: StreamConfig = loadStreamConfig();
  private readonly listeners = new Set<Listener>();

  private ffmpeg?: ChildProcessByStdio<null, Readable, Readable>;
  private restartTimer?: NodeJS.Timeout;
  private stopping = false;

  onModuleInit(): void {
    this.start();
  }

  onModuleDestroy(): void {
    this.stopping = true;
    if (this.restartTimer) clearTimeout(this.restartTimer);
    this.ffmpeg?.kill('SIGTERM');
    this.listeners.clear();
  }

  /** Station identity + live listener count, for the UI and metadata. */
  getStationInfo() {
    return {
      ...this.config.station,
      listeners: this.listeners.size,
      online: !!this.ffmpeg && !this.ffmpeg.killed,
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

  /**
   * Write an ffmpeg concat-demuxer playlist. Absolute paths are quoted and any
   * single quotes escaped, so arbitrary filenames are safe with `-safe 0`.
   */
  private writeConcatFile(files: string[]): string {
    const body = files
      .map((file) => `file '${file.replace(/'/g, "'\\''")}'`)
      .join('\n');
    const path = join(tmpdir(), 'radio-playlist.txt');
    writeFileSync(path, `${body}\n`, 'utf8');
    return path;
  }

  private start(): void {
    if (this.stopping) return;

    let playlist: string;
    try {
      const files = this.resolvePlaylist();
      playlist = this.writeConcatFile(files);
      this.logger.log(
        `Broadcasting ${files.length} track(s) from ${this.config.mediaDir}`,
      );
    } catch (err) {
      this.logger.error((err as Error).message);
      this.scheduleRestart();
      return;
    }

    // -re paces input at real time (the key to a shared playhead);
    // -stream_loop -1 repeats the whole playlist forever;
    // re-encoding to CBR MP3 yields one clean, joinable stream.
    const args = [
      '-hide_banner',
      '-loglevel',
      'error',
      '-re',
      '-stream_loop',
      '-1',
      '-f',
      'concat',
      '-safe',
      '0',
      '-i',
      playlist,
      '-vn',
      '-c:a',
      'libmp3lame',
      '-b:a',
      this.config.bitrate,
      '-ar',
      String(this.config.sampleRate),
      '-f',
      'mp3',
      'pipe:1',
    ];

    const child = spawn(this.config.ffmpegPath, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    this.ffmpeg = child;

    child.stdout.on('data', (chunk: Buffer) => this.broadcast(chunk));
    child.stderr.on('data', (chunk: Buffer) =>
      this.logger.warn(`ffmpeg: ${chunk.toString().trim()}`),
    );
    child.on('error', (err) =>
      this.logger.error(`Failed to spawn ffmpeg: ${err.message}`),
    );
    child.on('close', (code) => {
      if (this.stopping) return;
      this.logger.warn(`ffmpeg exited (code ${code}); restarting`);
      this.ffmpeg = undefined;
      this.scheduleRestart();
    });
  }

  private scheduleRestart(): void {
    if (this.stopping) return;
    if (this.restartTimer) clearTimeout(this.restartTimer);
    this.restartTimer = setTimeout(
      () => this.start(),
      this.config.restartDelayMs,
    );
  }

  /** Push one chunk to every listener, pruning any that have gone away. */
  private broadcast(chunk: Buffer): void {
    for (const listener of this.listeners) {
      if (listener.destroyed) {
        this.listeners.delete(listener);
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
