import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  type OnModuleInit,
} from '@nestjs/common';
import { spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { createReadStream, existsSync, statSync } from 'node:fs';
import { mkdir, rename, rm, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, extname, join } from 'node:path';
import { MediaStoreService } from '../media/media-store.service';
import { SequencerService } from '../stream/dj/sequencer.service';
import { loadStreamConfig } from '../stream/stream.config';
import { spawnLowPriority } from '../stream/tts/spawn-nice';
import { readTags } from './read-tags';
import { SongsService } from './songs.service';
import {
  downloadArgs,
  explainFailure,
  importKey,
  listArgs,
  listingTags,
  mergeTags,
  type TrackTags,
  uploadKey,
  validateImportUrl,
} from './ytdlp';

export type ItemState =
  | 'queued'
  | 'downloading'
  | 'checking'
  | 'uploading'
  | 'done'
  | 'skipped'
  | 'failed';

export interface ImportItem {
  title: string;
  state: ItemState;
  /** Why it failed, or why it was skipped. */
  note?: string;
}

export interface ImportJob {
  id: string;
  kind: 'link' | 'upload';
  /** The link imported from, for a link job. */
  source?: string;
  state: 'listing' | 'importing' | 'done' | 'failed';
  error?: string;
  items: ImportItem[];
  startedAt: string;
  finishedAt?: string;
}

/** A file multer has written to the temp directory. */
export interface UploadedFile {
  path: string;
  originalname: string;
}

/** Where temp files go: incoming uploads, and one folder per link job. */
export const IMPORT_TMP = join(tmpdir(), 'radio-import');

/**
 * Brings music into the station from a link or from uploaded files.
 *
 * Everything lands in the bucket — a local disk would lose it on the next
 * deploy — and enters the library *skipped*, so nothing airs until the operator
 * has checked it. One job runs at a time, in the background: a playlist can
 * take minutes, far longer than a web request may stay open, so the page polls
 * {@link status} instead.
 *
 * Downloads run at the lowest CPU priority. Converting to MP3 is heavy and the
 * host is small; running niced, with the engine's decode-ahead cushion, keeps
 * the broadcast from stuttering while an import churns.
 */
@Injectable()
export class ImportService implements OnModuleInit {
  private readonly logger = new Logger(ImportService.name);
  private readonly config = loadStreamConfig();
  private ytdlpVersion: string | null = null;
  private job: ImportJob | null = null;

  constructor(
    private readonly songs: SongsService,
    private readonly media: MediaStoreService,
    private readonly sequencer: SequencerService,
  ) {}

  async onModuleInit(): Promise<void> {
    this.ytdlpVersion = await this.probeYtdlp();
    this.logger.log(
      this.ytdlpVersion
        ? `yt-dlp ${this.ytdlpVersion} available for link imports`
        : 'yt-dlp not found — link imports are unavailable',
    );
  }

  /** What can be imported right now, and why not when it can't. */
  capabilities(): { link: boolean; upload: boolean; reasons: string[] } {
    const reasons: string[] = [];
    if (!this.config.adminPassword) {
      reasons.push('Set ADMIN_PASSWORD to enable importing.');
    }
    if (!this.media.usingRemote) {
      reasons.push(
        'Importing needs the R2 bucket; anything saved to the server disk would be lost on the next deploy.',
      );
    }
    const upload = reasons.length === 0;
    if (upload && !this.ytdlpVersion) {
      reasons.push('Link import needs yt-dlp, which is not installed.');
    }
    return { link: upload && !!this.ytdlpVersion, upload, reasons };
  }

  status() {
    return { ...this.capabilities(), job: this.job };
  }

  private get busy(): boolean {
    return this.job?.state === 'listing' || this.job?.state === 'importing';
  }

  /** Start importing a playlist or a single track from a link. */
  startLink(rawUrl: unknown): ImportJob {
    const caps = this.capabilities();
    if (!caps.link) throw new ForbiddenException(caps.reasons.join(' '));
    if (this.busy) throw new ConflictException('An import is already running');
    let url: string;
    try {
      url = validateImportUrl(rawUrl);
    } catch (err) {
      throw new BadRequestException((err as Error).message);
    }
    const job = this.newJob('link', url);
    void this.runLink(job, url);
    return job;
  }

  /** Start importing files the operator uploaded. */
  async startUpload(files: UploadedFile[]): Promise<ImportJob> {
    const caps = this.capabilities();
    const refuse = async (err: Error) => {
      await Promise.all(files.map((f) => unlink(f.path).catch(() => {})));
      throw err;
    };
    if (!caps.upload)
      return refuse(new ForbiddenException(caps.reasons.join(' ')));
    if (this.busy)
      return refuse(new ConflictException('An import is already running'));
    if (files.length === 0)
      return refuse(new BadRequestException('Choose at least one .mp3 file'));
    const job = this.newJob('upload');
    job.items = files.map((f) => ({ title: f.originalname, state: 'queued' }));
    job.state = 'importing';
    void this.runUpload(job, files);
    return job;
  }

  private newJob(kind: ImportJob['kind'], source?: string): ImportJob {
    this.job = {
      id: randomUUID().slice(0, 8),
      kind,
      source,
      state: 'listing',
      items: [],
      startedAt: new Date().toISOString(),
    };
    this.logger.log(
      `Import ${this.job.id} started (${kind}${source ? `: ${source}` : ''})`,
    );
    return this.job;
  }

  private async runLink(job: ImportJob, url: string): Promise<void> {
    const dir = join(IMPORT_TMP, job.id);
    const imported = new Set<string>();
    try {
      await mkdir(dir, { recursive: true });
      const { stdout } = await this.ytdlp(
        listArgs(url, this.config.import.maxTracks),
        120_000,
      );
      const plan = this.parseListing(stdout, url);
      if (plan.length === 0)
        throw new Error('No tracks were found at that link');
      job.items = plan.map((p) => ({ title: p.title, state: 'queued' }));
      job.state = 'importing';

      const existing = new Set(await this.media.listRemote());
      for (const [i, entry] of plan.entries()) {
        const item = job.items[i];
        if (existing.has(entry.key)) {
          item.state = 'skipped';
          item.note = 'Already in the library';
          continue;
        }
        try {
          item.state = 'downloading';
          const file = await this.download(entry.url, dir);
          await this.fillTags(file, entry.tags);
          item.state = 'uploading';
          await this.media.upload(file, entry.key);
          await unlink(file).catch(() => {});
          imported.add(entry.key);
          item.state = 'done';
        } catch (err) {
          item.state = 'failed';
          item.note = (err as Error).message;
        }
      }
      await this.catalogue(imported);
      job.state = 'done';
    } catch (err) {
      job.state = 'failed';
      job.error = (err as Error).message;
      // Anything uploaded before the failure should still reach the library.
      await this.catalogue(imported).catch(() => {});
    } finally {
      await rm(dir, { recursive: true, force: true }).catch(() => {});
      this.finish(job);
    }
  }

  private async runUpload(
    job: ImportJob,
    files: UploadedFile[],
  ): Promise<void> {
    const imported = new Set<string>();
    try {
      const existing = new Set(await this.media.listRemote());
      for (const [i, file] of files.entries()) {
        const item = job.items[i];
        try {
          item.state = 'checking';
          if (!(await this.isAudio(file.path))) {
            throw new Error('Not a playable audio file');
          }
          const key = uploadKey(file.originalname, await sha1Of(file.path));
          if (existing.has(key)) {
            item.state = 'skipped';
            item.note = 'Already in the library';
            continue;
          }
          item.state = 'uploading';
          await this.media.upload(file.path, key);
          imported.add(key);
          item.state = 'done';
        } catch (err) {
          item.state = 'failed';
          item.note = (err as Error).message;
        }
      }
      await this.catalogue(imported);
      job.state = 'done';
    } catch (err) {
      job.state = 'failed';
      job.error = (err as Error).message;
      await this.catalogue(imported).catch(() => {});
    } finally {
      await Promise.all(files.map((f) => unlink(f.path).catch(() => {})));
      this.finish(job);
    }
  }

  /** Add what arrived to the library (skipped) and to the running order. */
  private async catalogue(imported: ReadonlySet<string>): Promise<void> {
    if (imported.size === 0) return;
    await this.songs.reconcile({ arriveSkipped: imported });
    try {
      await this.sequencer.refreshPlaylist();
    } catch (err) {
      this.logger.warn(
        `running order not refreshed: ${(err as Error).message}`,
      );
    }
  }

  private finish(job: ImportJob): void {
    job.finishedAt = new Date().toISOString();
    const count = (s: ItemState) =>
      job.items.filter((i) => i.state === s).length;
    this.logger.log(
      `Import ${job.id} ${job.state}: ${count('done')} added, ` +
        `${count('skipped')} already present, ${count('failed')} failed` +
        (job.error ? ` — ${job.error}` : ''),
    );
  }

  /** Turn yt-dlp's listing into the tracks to fetch, capped at the limit. */
  private parseListing(
    stdout: string,
    url: string,
  ): { title: string; url: string; key: string; tags: TrackTags }[] {
    let info: Record<string, unknown>;
    try {
      info = JSON.parse(stdout) as Record<string, unknown>;
    } catch {
      throw new Error('Could not read what that link contains');
    }
    const str = (v: unknown) => (typeof v === 'string' && v ? v : undefined);
    const extractor = str(info.extractor_key) ?? str(info.extractor) ?? 'web';
    const entries = Array.isArray(info.entries)
      ? (info.entries as Record<string, unknown>[])
      : [info];
    return entries
      .filter((e) => e && str(e.id))
      .slice(0, this.config.import.maxTracks)
      .map((e) => ({
        title: str(e.title) ?? str(e.id)!,
        url: str(e.url) ?? str(e.webpage_url) ?? str(e.original_url) ?? url,
        key: importKey(str(e.ie_key) ?? extractor, str(e.id)!),
        tags: listingTags(e, info),
      }));
  }

  /** Download one track as a tagged MP3; returns the finished file's path. */
  private async download(url: string, dir: string): Promise<string> {
    const { stdout } = await this.ytdlp(
      downloadArgs({
        url,
        outDir: dir,
        maxFileMb: this.config.import.maxFileMb,
        ffmpegPath: this.config.ffmpegPath,
      }),
      10 * 60_000,
    );
    const file = stdout.trim().split('\n').filter(Boolean).pop();
    if (!file || !existsSync(file) || statSync(file).size === 0) {
      throw new Error('The download produced no audio');
    }
    return file;
  }

  /**
   * Give the downloaded file a real title and artist where it has none.
   * Some sites hand out direct file links, which arrive tagged with just the
   * file name; the listing knew better. Copies the audio untouched.
   */
  private async fillTags(file: string, listing: TrackTags): Promise<void> {
    const current = await readTags(this.config.ffprobePath, file);
    const stem = basename(file, extname(file));
    const { tags, changed } = mergeTags(current, listing, stem);
    if (!changed) return;
    const out = `${file}.tagged.mp3`;
    await new Promise<void>((resolve, reject) => {
      const args = [
        '-v',
        'error',
        '-y',
        '-i',
        file,
        '-map',
        '0',
        '-c',
        'copy',
        '-id3v2_version',
        '3',
      ];
      if (tags.title) args.push('-metadata', `title=${tags.title}`);
      if (tags.artist) args.push('-metadata', `artist=${tags.artist}`);
      args.push(out);
      const proc = spawn(this.config.ffmpegPath, args, { stdio: 'ignore' });
      proc.on('error', reject);
      proc.on('close', (code) =>
        code === 0 ? resolve() : reject(new Error(`retag failed (${code})`)),
      );
    });
    await rename(out, file);
  }

  /** Run yt-dlp at low priority, failing with a readable reason. */
  private ytdlp(
    args: string[],
    timeoutMs: number,
  ): Promise<{ stdout: string; stderr: string }> {
    return new Promise((resolve, reject) => {
      const proc = spawnLowPriority(this.config.import.ytdlpPath, args, {
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      let stdout = '';
      let stderr = '';
      proc.stdout?.on('data', (d: Buffer) => (stdout += d.toString()));
      proc.stderr?.on('data', (d: Buffer) => (stderr += d.toString()));
      const timer = setTimeout(() => {
        proc.kill('SIGKILL');
        reject(new Error('Timed out'));
      }, timeoutMs);
      proc.on('error', (err) => {
        clearTimeout(timer);
        reject(err);
      });
      proc.on('close', (code) => {
        clearTimeout(timer);
        if (code === 0) resolve({ stdout, stderr });
        else reject(new Error(explainFailure(stderr)));
      });
    });
  }

  /** The yt-dlp version, or null when it isn't installed. */
  private probeYtdlp(): Promise<string | null> {
    return new Promise((resolve) => {
      const proc = spawn(this.config.import.ytdlpPath, ['--version'], {
        stdio: ['ignore', 'pipe', 'ignore'],
      });
      let out = '';
      proc.stdout.on('data', (d: Buffer) => (out += d.toString()));
      proc.on('error', () => resolve(null));
      proc.on('close', (code) => resolve(code === 0 ? out.trim() : null));
    });
  }

  /** Whether ffprobe finds an audio stream in the file. */
  private isAudio(path: string): Promise<boolean> {
    return new Promise((resolve) => {
      const proc = spawn(
        this.config.ffprobePath,
        [
          '-v',
          'error',
          '-select_streams',
          'a:0',
          '-show_entries',
          'stream=codec_type',
          '-of',
          'csv=p=0',
          path,
        ],
        { stdio: ['ignore', 'pipe', 'ignore'] },
      );
      let out = '';
      proc.stdout.on('data', (d: Buffer) => (out += d.toString()));
      proc.on('error', () => resolve(false));
      proc.on('close', () => resolve(out.trim() === 'audio'));
    });
  }
}

/** SHA-1 of a file's contents, streamed so a large file is not held in memory. */
function sha1Of(path: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha1');
    createReadStream(path)
      .on('data', (chunk) => hash.update(chunk))
      .on('error', reject)
      .on('end', () => resolve(hash.digest('hex')));
  });
}
