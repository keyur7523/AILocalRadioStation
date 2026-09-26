import { Injectable, Logger } from '@nestjs/common';
import { existsSync, mkdirSync, statSync } from 'node:fs';
import { readFile, rename, writeFile } from 'node:fs/promises';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { loadStreamConfig } from '../stream/stream.config';
import { R2Client } from './r2.client';

/**
 * Where the music lives.
 *
 * Two sources, one interface: an object-storage bucket when one is configured,
 * otherwise the media folder baked into the image (which is what the station
 * has always done, and remains the fallback if the bucket is unreachable).
 *
 * The important rule is that **ffmpeg only ever opens a local file**. Tracks are
 * copied out of the bucket ahead of time and played from disk, never streamed
 * from the network into the decoder: a stalled HTTP read at an item boundary is
 * dead air for every listener, which is exactly the failure the whole engine is
 * built to avoid. The local copy also means the bucket is read once per file
 * rather than once per play.
 */
@Injectable()
export class MediaStoreService {
  private readonly logger = new Logger(MediaStoreService.name);
  private readonly config = loadStreamConfig();
  private readonly remote: R2Client | null;
  private readonly cacheDir: string;
  /** In-flight downloads, so two callers never fetch the same file twice. */
  private readonly downloads = new Map<string, Promise<string>>();

  constructor() {
    const { r2 } = this.config;
    this.cacheDir = r2.cacheDir;
    const addressable = r2.accountId || r2.endpoint;
    if (addressable && r2.bucket && r2.accessKeyId && r2.secretAccessKey) {
      this.remote = new R2Client(
        r2.accountId,
        r2.bucket,
        r2.accessKeyId,
        r2.secretAccessKey,
        r2.endpoint || undefined,
      );
      mkdirSync(this.cacheDir, { recursive: true });
      this.logger.log(
        `Music from R2 bucket "${r2.bucket}" (cached in ${this.cacheDir})`,
      );
    } else {
      this.remote = null;
      this.logger.log(`Music from ${this.config.mediaDir}`);
    }
  }

  /** Whether tracks come from object storage rather than the image. */
  get usingRemote(): boolean {
    return this.remote !== null;
  }

  /**
   * The filenames that make up the library. From the bucket when configured,
   * falling back to the media folder if the bucket cannot be reached — a
   * listing failure should cost us new tracks, not the whole station.
   */
  async list(): Promise<string[]> {
    if (!this.remote) return this.listLocal();
    try {
      const objects = await this.remote.list();
      const names = objects
        .map((o) => o.key)
        .filter((k) => k.toLowerCase().endsWith('.mp3'))
        .sort();
      this.logger.log(`Bucket holds ${names.length} track(s)`);
      return names;
    } catch (err) {
      const local = this.listLocal();
      this.logger.error(
        `Could not list the bucket (${(err as Error).message}) — ` +
          `playing the ${local.length} track(s) already on disk`,
      );
      return local;
    }
  }

  /**
   * The complete set of tracks, or an error — never a best-effort substitute.
   *
   * `list()` falls back to whatever happens to be on disk when the bucket is
   * unreachable, which is right for playback and wrong for bookkeeping: that
   * fallback is usually a partial cache, and anything deciding what *exists*
   * from it would conclude every uncached track had been removed. Callers that
   * add or delete records must use this and stop if it throws.
   */
  async listAuthoritative(): Promise<string[]> {
    return this.remote ? this.listRemote() : this.listLocal();
  }

  /**
   * What the bucket holds, failing loudly if it cannot be read.
   *
   * `list()` deliberately falls back to local files so the broadcast survives an
   * outage, but that is exactly wrong for uploading: a caller comparing against
   * a fallback listing would conclude the local files were already uploaded and
   * silently skip them. Tooling that writes must use this instead.
   */
  async listRemote(): Promise<string[]> {
    if (!this.remote) throw new Error('No bucket configured');
    const objects = await this.remote.list();
    return objects
      .map((o) => o.key)
      .filter((k) => k.toLowerCase().endsWith('.mp3'))
      .sort();
  }

  /**
   * Every track playable without the network: ones already downloaded from the
   * bucket, plus anything shipped in the image.
   *
   * Including the download cache is what keeps an outage survivable. A station
   * that has been running has its whole rotation on disk already, and going
   * silent because the bucket is briefly unreachable would be absurd — the
   * music is right there.
   */
  private listLocal(): string[] {
    const dirs = this.remote
      ? [this.cacheDir, this.config.mediaDir]
      : [this.config.mediaDir];
    const names = new Set<string>();
    for (const dir of dirs) {
      if (!existsSync(dir)) continue;
      for (const f of readdirSync(dir)) {
        if (f.toLowerCase().endsWith('.mp3')) names.add(f);
      }
    }
    return [...names].sort();
  }

  /**
   * An absolute path ffmpeg can open, downloading the file first if it only
   * exists remotely. Safe to call repeatedly: a cached file is returned
   * immediately and concurrent callers share one download.
   */
  ensureLocal(file: string): Promise<string> {
    if (!this.remote) return Promise.resolve(join(this.config.mediaDir, file));

    const target = join(this.cacheDir, file);
    if (existsSync(target) && statSync(target).size > 0) {
      return Promise.resolve(target);
    }
    let pending = this.downloads.get(file);
    if (!pending) {
      pending = this.download(file, target).finally(() =>
        this.downloads.delete(file),
      );
      this.downloads.set(file, pending);
    }
    return pending;
  }

  /**
   * Fetch one track. Written to a temporary name and moved into place, so an
   * interrupted download can never leave a truncated file that ffmpeg would
   * later play as a clipped song.
   */
  private async download(file: string, target: string): Promise<string> {
    const startedAt = Date.now();
    // A file shipped in the image needs no fetching, even when a bucket is
    // configured — this is what lets the two sources coexist.
    const shipped = join(this.config.mediaDir, file);
    if (existsSync(shipped)) return shipped;
    const bytes = await this.remote!.get(file);
    const partial = `${target}.part`;
    await writeFile(partial, bytes);
    await rename(partial, target);
    this.logger.log(
      `⬇  fetched ${file} (${(bytes.length / 1024 / 1024).toFixed(1)} MB in ${Date.now() - startedAt}ms)`,
    );
    return target;
  }

  /** Upload a local file into the bucket, for the import tooling. */
  async upload(localPath: string, key: string): Promise<void> {
    if (!this.remote) throw new Error('No bucket configured');
    await this.remote.put(key, await readFile(localPath));
  }
}
