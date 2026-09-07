import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { DatabaseGateway } from '../db/database.gateway';
import { MediaStoreService } from '../media/media-store.service';
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
  private readonly mediaDir = loadStreamConfig().mediaDir;
  private readonly ffprobePath = loadStreamConfig().ffprobePath;

  constructor(
    private readonly db: DatabaseGateway,
    private readonly media: MediaStoreService,
  ) {}

  get available(): boolean {
    return this.db.available;
  }

  async onModuleInit(): Promise<void> {
    if (!this.db.available) {
      this.logger.log('No database — library is the media folder, read-only');
      return;
    }
    await this.reconcile();
  }

  /** The filenames the library should contain, from wherever music lives. */
  private filesAvailable(): Promise<string[]> {
    return this.media.list();
  }

  /**
   * Bring the table in line with the folder: add rows for new files (reading
   * title/artist from their tags), and remove rows whose file has disappeared.
   * Existing rows are left alone so admin edits are never clobbered.
   */
  async reconcile(): Promise<void> {
    const onDisk = await this.filesAvailable();
    await this.db.run(async (ds) => {
      const repo = ds.getRepository(Song);
      const rows = await repo.find();
      const known = new Set(rows.map((r) => r.file));

      let position = rows.reduce((max, r) => Math.max(max, r.position), -1);
      let added = 0;
      for (const file of onDisk) {
        if (known.has(file)) continue;
        const path = `${this.mediaDir}/${file}`;
        const info = buildTrackInfo(
          await readTags(this.ffprobePath, path),
          path,
        );
        await repo.save(
          repo.create({
            file,
            title: info?.title ?? file,
            artist: info?.artist ?? null,
            position: ++position,
          }),
        );
        added += 1;
      }

      const gone = rows.filter((r) => !onDisk.includes(r.file));
      if (gone.length) await repo.remove(gone);

      if (added || gone.length) {
        this.logger.log(
          `Library synced: ${added} added, ${gone.length} removed, ${onDisk.length} on disk`,
        );
      }
      return true;
    });
  }

  /** Every song, in running order. */
  async list(): Promise<Song[]> {
    return (
      (await this.db.run((ds) =>
        ds.getRepository(Song).find({ order: { position: 'ASC' } }),
      )) ?? []
    );
  }

  /** The files that should actually play, in order, skipping rested tracks. */
  async playable(): Promise<Song[]> {
    return (
      (await this.db.run((ds) =>
        ds.getRepository(Song).find({
          where: { skip: false },
          order: { position: 'ASC' },
        }),
      )) ?? []
    );
  }

  async update(id: string, patch: Partial<Song>): Promise<Song> {
    const saved = await this.db.run(async (ds) => {
      const repo = ds.getRepository(Song);
      const song = await repo.findOne({ where: { id } });
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
        if (key === 'title' && !trimmed)
          throw new Error('Title cannot be empty');
        song[key] = (trimmed || null) as never;
      }
      if (typeof patch.skip === 'boolean') song.skip = patch.skip;
      if (typeof patch.position === 'number') song.position = patch.position;
      return repo.save(song);
    });
    if (!saved) throw new Error('Could not save — the library is unavailable');
    return saved;
  }

  /**
   * Forget a song. The file stays in the image (it ships there), so a later
   * reconcile would re-add it — resting it with `skip` is usually what's wanted.
   */
  async remove(id: string): Promise<void> {
    const done = await this.db.run((ds) =>
      ds.getRepository(Song).delete({ id }),
    );
    if (!done) throw new Error('Could not delete — the library is unavailable');
  }

  /** Apply an explicit running order, given song ids first-to-last. */
  async reorder(ids: string[]): Promise<Song[]> {
    const done = await this.db.run(async (ds) => {
      const repo = ds.getRepository(Song);
      for (const [index, id] of ids.entries()) {
        await repo.update({ id }, { position: index });
      }
      return true;
    });
    if (!done)
      throw new Error('Could not reorder — the library is unavailable');
    return this.list();
  }
}
