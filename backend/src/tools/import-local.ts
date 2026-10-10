/**
 * Import a playlist or track into the station from this computer.
 *
 * Downloads run here, on a home connection, which sites like YouTube rarely
 * block — unlike the data-centre server the station runs on. The finished files
 * are then sent through the station's own upload API, so they land exactly as
 * an upload from the admin panel would: saved to the bucket, tagged, arriving
 * skipped, and recognised if they are already there.
 *
 * Usage:
 *   npm run build
 *   npm run import -- "<playlist or track link>" [--max 50]
 *
 * Reads from the environment (backend/.env works):
 *   STATION_URL         the station's backend (default http://localhost:3001)
 *   ADMIN_PASSWORD      the admin password set on that station
 *   YTDLP               the yt-dlp binary (default "yt-dlp" on PATH)
 *   YTDLP_COOKIES_FILE  optional; rarely needed from a home connection
 *
 * Needs yt-dlp and ffmpeg installed locally. Only import music you have the
 * rights to broadcast.
 */
import '../load-env';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { openAsBlob } from 'node:fs';
import { chmod, copyFile, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadStreamConfig } from '../stream/stream.config';
import { downloadTrack, runYtdlp, type YtRunner } from '../library/yt-runner';
import {
  keyPart,
  listArgs,
  parseListing,
  uploadKey,
  validateImportUrl,
} from '../library/ytdlp';

/** The station's limit on files per upload request. */
const BATCH = 20;

interface Job {
  id: string;
  state: string;
  error?: string;
  items: { title: string; state: string; note?: string }[];
}

function parseArgs(argv: string[]): { url: string; max: number } {
  const rest: string[] = [];
  let max = 50;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--max') max = Math.max(1, Number(argv[++i]) || max);
    else rest.push(argv[i]);
  }
  if (!rest[0]) {
    throw new Error(
      'Usage: npm run import -- "<playlist or track link>" [--max 50]',
    );
  }
  return { url: validateImportUrl(rest[0]), max };
}

/** A small client for the station's admin API. */
function stationClient(base: string, password: string) {
  const auth = `Basic ${Buffer.from(`admin:${password}`).toString('base64')}`;
  const call = async (path: string, init: RequestInit = {}) => {
    const res = await fetch(`${base}${path}`, {
      ...init,
      headers: { ...(init.headers ?? {}), Authorization: auth },
    });
    if (res.status === 401) {
      throw new Error(
        'The station refused the password — check ADMIN_PASSWORD',
      );
    }
    return res;
  };
  return {
    async json<T>(path: string): Promise<T> {
      const res = await call(path);
      if (!res.ok) throw new Error(`${path} → HTTP ${res.status}`);
      return (await res.json()) as T;
    },
    upload: (form: FormData) =>
      call('/admin/import/upload', { method: 'POST', body: form }),
  };
}

/** The yt-dlp version installed here, or null. */
function ytdlpVersion(path: string): Promise<string | null> {
  return new Promise((resolve) => {
    const proc = spawn(path, ['--version'], {
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    let out = '';
    proc.stdout.on('data', (d: Buffer) => (out += d.toString()));
    proc.on('error', () => resolve(null));
    proc.on('close', (code) => resolve(code === 0 ? out.trim() : null));
  });
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main(): Promise<void> {
  const { url, max } = parseArgs(process.argv.slice(2));
  const config = loadStreamConfig();
  const base = (process.env.STATION_URL ?? 'http://localhost:3001').replace(
    /\/+$/,
    '',
  );
  if (!config.adminPassword) {
    throw new Error(
      "Set ADMIN_PASSWORD (in backend/.env) to the station's admin password",
    );
  }

  const version = await ytdlpVersion(config.import.ytdlpPath);
  if (!version) {
    throw new Error(
      'yt-dlp is not installed. Install it (brew install yt-dlp, or the standalone ' +
        'binary from github.com/yt-dlp/yt-dlp/releases) or set YTDLP to its path.',
    );
  }

  const station = stationClient(base, config.adminPassword);
  const caps = await station.json<{ upload: boolean; reasons: string[] }>(
    '/admin/import',
  );
  if (!caps.upload) {
    throw new Error(
      `The station cannot accept imports: ${caps.reasons.join(' ')}`,
    );
  }
  const library = await station.json<{ songs: { file: string }[] }>(
    '/admin/songs',
  );
  const existing = library.songs.map((s) => s.file);

  console.log(`Station: ${base}   yt-dlp ${version}`);
  console.log('Only import music you have the rights to broadcast.\n');

  const work = join(tmpdir(), `radio-import-local-${randomUUID().slice(0, 8)}`);
  await mkdir(work, { recursive: true });
  try {
    let cookiesFile: string | undefined;
    if (config.import.cookiesFile) {
      // yt-dlp writes refreshed cookies back; keep the original untouched.
      cookiesFile = join(work, 'cookies.txt');
      await copyFile(config.import.cookiesFile, cookiesFile);
      await chmod(cookiesFile, 0o600);
    }
    const runner: YtRunner = {
      ytdlpPath: config.import.ytdlpPath,
      ffmpegPath: config.ffmpegPath,
      ffprobePath: config.ffprobePath,
      nodePath: process.execPath,
      cookiesFile,
    };

    console.log('Looking up what the link contains...');
    const { stdout } = await runYtdlp(runner, listArgs(url, max), 120_000);
    const entries = parseListing(stdout, url, max);
    if (entries.length === 0)
      throw new Error('No tracks were found at that link');
    console.log(`${entries.length} track(s).\n`);

    const ready: { file: string; name: string; title: string }[] = [];
    let skipped = 0;
    let failed = 0;
    for (const [i, entry] of entries.entries()) {
      const label = `[${i + 1}/${entries.length}] ${entry.title}`;
      // The name it will be uploaded as, and so the key prefix it gets on the
      // station — used to spot tracks imported before without downloading.
      const name = `${keyPart(entry.extractor, 20)}-${keyPart(entry.id, 40)}.mp3`;
      const prefix = uploadKey(name, '').replace(/-\.mp3$/, '-');
      if (existing.some((f) => f.startsWith(prefix))) {
        console.log(`${label} — already on the station`);
        skipped++;
        continue;
      }
      process.stdout.write(`${label} — downloading... `);
      try {
        const file = await downloadTrack(
          runner,
          entry.url,
          work,
          entry.tags,
          config.import.maxFileMb,
        );
        ready.push({ file, name, title: entry.title });
        console.log('done');
      } catch (err) {
        console.log(`failed: ${(err as Error).message}`);
        failed++;
      }
    }

    let added = 0;
    for (let start = 0; start < ready.length; start += BATCH) {
      const batch = ready.slice(start, start + BATCH);
      console.log(`\nSending ${batch.length} file(s) to the station...`);
      const job = await sendBatch(station, batch);
      for (const item of job.items) {
        if (item.state === 'done') added++;
        else if (item.state === 'skipped') skipped++;
        else if (item.state === 'failed') failed++;
        console.log(
          `  ${item.title} — ${item.state}${item.note ? ` (${item.note})` : ''}`,
        );
      }
      if (job.state === 'failed')
        console.log(`  Import stopped: ${job.error ?? 'unknown error'}`);
    }

    console.log(
      `\nFinished: ${added} added, ${skipped} already there, ${failed} failed.` +
        (added
          ? ' New tracks arrive skipped — untick them in the library to put them on air.'
          : ''),
    );
  } finally {
    await rm(work, { recursive: true, force: true });
  }
}

/** Upload one batch, waiting out any import already running, then follow it. */
async function sendBatch(
  station: ReturnType<typeof stationClient>,
  batch: { file: string; name: string }[],
): Promise<Job> {
  for (let attempt = 0; ; attempt++) {
    const form = new FormData();
    for (const f of batch) {
      form.append(
        'files',
        await openAsBlob(f.file, { type: 'audio/mpeg' }),
        f.name,
      );
    }
    const res = await station.upload(form);
    if (res.status === 409 && attempt < 120) {
      if (attempt === 0)
        console.log('  Another import is running on the station; waiting...');
      await sleep(5000);
      continue;
    }
    const body = (await res.json()) as Job & { message?: string };
    if (!res.ok)
      throw new Error(body.message ?? `Upload failed (HTTP ${res.status})`);
    const id = body.id;
    for (;;) {
      await sleep(2000);
      const { job } = await station.json<{ job: Job | null }>('/admin/import');
      if (
        job &&
        job.id === id &&
        job.state !== 'listing' &&
        job.state !== 'importing'
      ) {
        return job;
      }
    }
  }
}

main().catch((err: unknown) => {
  console.error(
    `\nImport failed: ${err instanceof Error ? err.message : String(err)}`,
  );
  process.exitCode = 1;
});
