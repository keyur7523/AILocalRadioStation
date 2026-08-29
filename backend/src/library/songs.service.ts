import { Inject, Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { existsSync, readdirSync } from 'node:fs';
import type { DataSource, Repository } from 'typeorm';
import { DATA_SOURCE } from '../db/database.provider';
import { Song } from '../db/entities/song.entity';
import { buildTrackInfo } from '../stream/dj/track-info';
import { loadStreamConfig } from '../stream/stream.config';
import { readTags } from './read-tags';

/**
 * The station's library: which songs exist, what the DJ calls them, what order
 * they play in, and which are rested.
 *
 * The audio files themselves are the ground truth for *existence* — they ship in
 * the image — so on boot the table is reconciled against the media folder: new
 * files are added, and rows whose file has gone are dropped. Everything the
 * admin edits (phonetics, order, skip) is preserved across that reconcile.
 *
 * Without a database this service simply reports the folder contents and refuses
 * edits, so the station still plays.
 */
@Injectable()
export class SongsService implements OnModuleInit {
  private readonly logger = new Logger(SongsService.name);
  private readonly repo: Repository<Song> | null;
  private readonly mediaDir = loadStreamConfig().mediaDir;
  private readonly ffprobePath = loadStreamConfig().ffprobePath;

  constructor(@Inject(DATA_SOURCE) dataSource: DataSource | null) {
    this.repo = dataSource ? dataSource.getRepository(Song) : null;
  }

  get available(): boolean {
    return this.repo !== null;
  }

  async onModuleInit(): Promise<void> {
    if (!this.repo) {
      this.logger.log('No database — library is the media folder, read-only');
      return;
    }
    try {
      await this.reconcile();
    } catch (err) {
      this.logger.warn(`library sync failed: ${(err as Error).message}`);
    }
  }

  /** Files currently present in the media folder, in filename order. */
  private filesOnDisk(): string[] {
    if (!existsSync(this.mediaDir)) return [];
    return readdirSync(this.mediaDir)
      .filter((f) => f.toLowerCase().endsWith('.mp3'))
      .sort();
  }

  /**
   * Bring the table in line with the folder: add rows for new files (reading
   * title/artist from their tags), and remove rows whose file has disappeared.
   * Existing rows are left alone so admin edits are never clobbered.
   */
  async reconcile(): Promise<void> {
    if (!this.repo) return;
    const onDisk = this.filesOnDisk();
    const rows = await this.repo.find();
    const known = new Set(rows.map((r) => r.file));

    let position = rows.reduce((max, r) => Math.max(max, r.position), -1);
    let added = 0;
    for (const file of onDisk) {
      if (known.has(file)) continue;
      const path = `${this.mediaDir}/${file}`;
      const info = buildTrackInfo(await readTags(this.ffprobePath, path), path);
      await this.repo.save(
        this.repo.create({
          file,
          title: info?.title ?? file,
          artist: info?.artist ?? null,
          position: ++position,
        }),
      );
      added += 1;
    }

    const gone = rows.filter((r) => !onDisk.includes(r.file));
    if (gone.length) await this.repo.remove(gone);

    if (added || gone.length) {
      this.logger.log(
        `Library synced: ${added} added, ${gone.length} removed, ${onDisk.length} on disk`,
      );
    }
  }

  /** Every song, in running order. */
  async list(): Promise<Song[]> {
    if (!this.repo) return [];
    return this.repo.find({ order: { position: 'ASC' } });
  }

  /** The files that should actually play, in order, skipping rested tracks. */
  async playable(): Promise<Song[]> {
    if (!this.repo) return [];
    return this.repo.find({
      where: { skip: false },
      order: { position: 'ASC' },
    });
  }

  async update(id: string, patch: Partial<Song>): Promise<Song> {
    if (!this.repo) throw new Error('No database — the library is read-only');
    const song = await this.repo.findOne({ where: { id } });
    if (!song) throw new Error(`No song with id "${id}"`);
    for (const key of [
      'title',
      'artist',
      'phoneticTitle',
      'phoneticArtist',
    ] as const) {
      const value = patch[key];
      if (value === undefined) continue;
      const trimmed = typeof value === 'string' ? value.trim() : value;
      // Empty means "clear it" for the optional fields, but a title must stay.
      if (key === 'title' && !trimmed) throw new Error('Title cannot be empty');
      song[key] = (trimmed || null) as never;
    }
    if (typeof patch.skip === 'boolean') song.skip = patch.skip;
    if (typeof patch.position === 'number') song.position = patch.position;
    return this.repo.save(song);
  }

  /**
   * Forget a song. The file stays in the image (it ships there), so a later
   * reconcile would re-add it — resting it with `skip` is usually what's wanted.
   */
  async remove(id: string): Promise<void> {
    if (!this.repo) throw new Error('No database — the library is read-only');
    await this.repo.delete({ id });
  }

  /** Apply an explicit running order, given song ids first-to-last. */
  async reorder(ids: string[]): Promise<Song[]> {
    if (!this.repo) throw new Error('No database — the library is read-only');
    for (const [index, id] of ids.entries()) {
      await this.repo.update({ id }, { position: index });
    }
    return this.list();
  }
}
