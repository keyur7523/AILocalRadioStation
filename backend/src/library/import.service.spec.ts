import { copyFile, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { MediaStoreService } from '../media/media-store.service';
import type { SequencerService } from '../stream/dj/sequencer.service';
import { ImportService, type ImportJob } from './import.service';
import type { SongsService } from './songs.service';

// A real track from the repo, so ffprobe has genuine audio to recognise.
const TRACK = join(__dirname, '../../media/02-morninglightmusic-happy-pop.mp3');

describe('ImportService uploads', () => {
  const saved = process.env.ADMIN_PASSWORD;
  let dir: string;
  let remote: string[];
  let uploaded: string[];
  let reconcile: jest.Mock;
  let refresh: jest.Mock;

  function service(): ImportService {
    return new ImportService(
      { reconcile } as unknown as SongsService,
      {
        usingRemote: true,
        listRemote: () => Promise.resolve(remote),
        upload: (_path: string, key: string) => {
          uploaded.push(key);
          return Promise.resolve();
        },
      } as unknown as MediaStoreService,
      { refreshPlaylist: refresh } as unknown as SequencerService,
    );
  }

  /** A file as multer leaves it: a temp path plus the name the browser sent. */
  async function incoming(name: string, from?: string) {
    const path = join(dir, `${Math.random()}`);
    if (from) await copyFile(from, path);
    else await writeFile(path, 'definitely not audio');
    return { path, originalname: name };
  }

  async function finished(job: ImportJob): Promise<ImportJob> {
    while (!job.finishedAt) await new Promise((r) => setTimeout(r, 20));
    return job;
  }

  beforeEach(async () => {
    process.env.ADMIN_PASSWORD = 'test-password';
    dir = await mkdtemp(join(tmpdir(), 'import-spec-'));
    remote = [];
    uploaded = [];
    reconcile = jest.fn(() => Promise.resolve());
    refresh = jest.fn(() => Promise.resolve());
  });

  afterEach(async () => {
    if (saved === undefined) delete process.env.ADMIN_PASSWORD;
    else process.env.ADMIN_PASSWORD = saved;
    await rm(dir, { recursive: true, force: true });
  });

  it('saves audio under a content-named key and adds it skipped', async () => {
    const good = await incoming('Happy Pop.mp3', TRACK);
    const bad = await incoming('fake.mp3');
    const job = await finished(await service().startUpload([good, bad]));

    expect(job.state).toBe('done');
    expect(job.items.map((i) => i.state)).toEqual(['done', 'failed']);
    expect(job.items[1].note).toMatch(/Not a playable audio file/);
    expect(uploaded).toHaveLength(1);
    expect(uploaded[0]).toMatch(/^uploads\/happy-pop-[0-9a-f]{8}\.mp3$/);
    expect(reconcile).toHaveBeenCalledWith({
      arriveSkipped: new Set(uploaded),
    });
    expect(refresh).toHaveBeenCalled();
    // Temp files are always cleaned up.
    expect(existsSync(good.path) || existsSync(bad.path)).toBe(false);
  });

  it('recognises a file already in the bucket and changes nothing', async () => {
    const first = service();
    await finished(await first.startUpload([await incoming('a.mp3', TRACK)]));
    remote = [...uploaded];
    uploaded = [];
    reconcile.mockClear();

    const job = await finished(
      await service().startUpload([await incoming('a.mp3', TRACK)]),
    );
    expect(job.items[0]).toMatchObject({
      state: 'skipped',
      note: 'Already in the library',
    });
    expect(uploaded).toEqual([]);
    expect(reconcile).not.toHaveBeenCalled();
  });

  it('refuses uploads without an admin password, and deletes the files', async () => {
    delete process.env.ADMIN_PASSWORD;
    const file = await incoming('a.mp3', TRACK);
    await expect(service().startUpload([file])).rejects.toThrow(
      /ADMIN_PASSWORD/,
    );
    expect(existsSync(file.path)).toBe(false);
  });

  it('refuses a second import while one is running', async () => {
    const s = service();
    const job = await s.startUpload([await incoming('a.mp3', TRACK)]);
    const second = await incoming('b.mp3', TRACK);
    await expect(s.startUpload([second])).rejects.toThrow(/already running/);
    expect(existsSync(second.path)).toBe(false);
    await finished(job);
  });
});
