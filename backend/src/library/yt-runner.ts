import { spawn } from 'node:child_process';
import { existsSync, statSync } from 'node:fs';
import { rename } from 'node:fs/promises';
import { basename, extname } from 'node:path';
import { spawnLowPriority } from '../stream/tts/spawn-nice';
import { readTags } from './read-tags';
import {
  downloadArgs,
  explainFailure,
  mergeTags,
  sessionArgs,
  type TrackTags,
} from './ytdlp';

/**
 * Running yt-dlp, shared by the server's importer and the local import tool so
 * both download, sign in and tag tracks in exactly the same way.
 */
export interface YtRunner {
  ytdlpPath: string;
  ffmpegPath: string;
  ffprobePath: string;
  /** Node to solve YouTube's challenges with; usually process.execPath. */
  nodePath?: string;
  /** A Netscape-format cookies file to sign requests in with. */
  cookiesFile?: string;
  /** Run at the lowest CPU priority — on the server, beside the broadcast. */
  lowPriority?: boolean;
}

/** Run yt-dlp with the session arguments, failing with a readable reason. */
export function runYtdlp(
  runner: YtRunner,
  args: string[],
  timeoutMs: number,
): Promise<{ stdout: string; stderr: string }> {
  const all = [
    ...sessionArgs({
      nodePath: runner.nodePath,
      cookiesFile: runner.cookiesFile,
    }),
    ...args,
  ];
  return new Promise((resolve, reject) => {
    const proc = runner.lowPriority
      ? spawnLowPriority(runner.ytdlpPath, all, {
          stdio: ['ignore', 'pipe', 'pipe'],
        })
      : spawn(runner.ytdlpPath, all, { stdio: ['ignore', 'pipe', 'pipe'] });
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
      else
        reject(
          new Error(explainFailure(stderr, { cookies: !!runner.cookiesFile })),
        );
    });
  });
}

/**
 * Download one track as a tagged MP3 into `dir`, filling in a title and artist
 * from the listing when the file comes back without real ones. Returns the
 * finished file's path.
 */
export async function downloadTrack(
  runner: YtRunner,
  url: string,
  dir: string,
  listing: TrackTags,
  maxFileMb: number,
): Promise<string> {
  const { stdout } = await runYtdlp(
    runner,
    downloadArgs({
      url,
      outDir: dir,
      maxFileMb,
      ffmpegPath: runner.ffmpegPath,
    }),
    10 * 60_000,
  );
  const file = stdout.trim().split('\n').filter(Boolean).pop();
  if (!file || !existsSync(file) || statSync(file).size === 0) {
    throw new Error('The download produced no audio');
  }
  await fillMissingTags(runner, file, listing);
  return file;
}

/**
 * Give a downloaded file a real title and artist where it has none. Some sites
 * hand out direct file links, which arrive tagged with just the file name; the
 * listing knew better. The audio is copied untouched.
 */
async function fillMissingTags(
  runner: YtRunner,
  file: string,
  listing: TrackTags,
): Promise<void> {
  const current = await readTags(runner.ffprobePath, file);
  const { tags, changed } = mergeTags(
    current,
    listing,
    basename(file, extname(file)),
  );
  if (!changed) return;
  const out = `${file}.tagged.mp3`;
  const args = ['-v', 'error', '-y', '-i', file, '-map', '0', '-c', 'copy'];
  args.push('-id3v2_version', '3');
  if (tags.title) args.push('-metadata', `title=${tags.title}`);
  if (tags.artist) args.push('-metadata', `artist=${tags.artist}`);
  args.push(out);
  await new Promise<void>((resolve, reject) => {
    const proc = spawn(runner.ffmpegPath, args, { stdio: 'ignore' });
    proc.on('error', reject);
    proc.on('close', (code) =>
      code === 0 ? resolve() : reject(new Error(`retag failed (${code})`)),
    );
  });
  await rename(out, file);
}
