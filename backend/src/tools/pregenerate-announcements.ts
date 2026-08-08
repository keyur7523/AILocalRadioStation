/**
 * Pre-generate the DJ's track announcements into the clip cache.
 *
 * The lines naming a track ("That was X by Y.", "Next up, X by Y.") never
 * change, so there's no reason to synthesize them on a live server — especially
 * a small one, where neural TTS runs slower than real time and competes with the
 * audio pipeline for CPU. This runs at **image build time**, where the same
 * Piper binary and voice are available, and bakes the clips into the image.
 *
 * Correctness rests on using the app's own code: the cache is content-addressed
 * over (engine, voice, text), so the tool builds its phrases with
 * `staticSegmentsFor` and its engine with `createTtsService` — the very things
 * the running station uses. Nothing here can drift from runtime behaviour.
 *
 * Only the short time-of-day line is left to synthesize live, and that one is
 * pre-warmed once a minute.
 *
 * Usage:  node dist/tools/pregenerate-announcements.js
 * Never fails the build — a station with no tags (or no TTS) simply falls back
 * to generating live, exactly as before.
 */
import { spawn } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { staticSegmentsFor } from '../stream/dj/announcements';
import { buildTrackInfo } from '../stream/dj/track-info';
import { loadStreamConfig } from '../stream/stream.config';
import { createTtsService } from '../stream/tts/tts.provider';

/** Read a file's title/artist tags via ffprobe (mirrors the sequencer). */
function readTags(
  ffprobePath: string,
  path: string,
): Promise<{ title?: string; artist?: string }> {
  return new Promise((resolve) => {
    const proc = spawn(
      ffprobePath,
      [
        '-v',
        'error',
        '-show_entries',
        'format_tags=title,artist',
        '-of',
        'json',
        path,
      ],
      { stdio: ['ignore', 'pipe', 'pipe'] },
    );
    let out = '';
    proc.stdout.on('data', (d: Buffer) => (out += d.toString()));
    proc.on('error', () => resolve({}));
    proc.on('close', () => {
      try {
        const parsed = JSON.parse(out || '{}') as {
          format?: { tags?: { title?: string; artist?: string } };
        };
        resolve(parsed.format?.tags ?? {});
      } catch {
        resolve({});
      }
    });
  });
}

async function main(): Promise<void> {
  const config = loadStreamConfig();
  const { mediaDir, ffprobePath, dj } = config;

  if (!dj.announceTracks) {
    console.log('[pregenerate] track announcements disabled — nothing to do');
    return;
  }
  if (!existsSync(mediaDir)) {
    console.log(`[pregenerate] no media directory at ${mediaDir} — skipping`);
    return;
  }

  const tracks = readdirSync(mediaDir)
    .filter((n) => n.toLowerCase().endsWith('.mp3'))
    .sort()
    .map((n) => join(mediaDir, n));

  if (tracks.length === 0) {
    console.log(`[pregenerate] no .mp3 files in ${mediaDir} — skipping`);
    return;
  }

  const tts = createTtsService();
  console.log(
    `[pregenerate] ${tracks.length} track(s) → cache ${dj.cacheDir} ` +
      `(engine: ${dj.ttsEngine})`,
  );

  let made = 0;
  let failed = 0;
  for (const path of tracks) {
    const info = buildTrackInfo(await readTags(ffprobePath, path), path);
    if (!info) {
      console.log(`[pregenerate] ${path}: no usable metadata — skipping`);
      continue;
    }
    // Sequential on purpose: a speech engine can hold a few hundred MB, and
    // build machines are not always roomy.
    for (const text of staticSegmentsFor(info)) {
      try {
        await tts.synthesize(text);
        made += 1;
        console.log(`[pregenerate]   ✓ "${text}"`);
      } catch (err) {
        failed += 1;
        console.warn(`[pregenerate]   ✗ "${text}": ${(err as Error).message}`);
      }
    }
  }
  console.log(
    `[pregenerate] done — ${made} clip(s) cached` +
      (failed ? `, ${failed} failed (will generate live instead)` : ''),
  );
}

main().catch((err: unknown) => {
  // Never break the build over this; the station just synthesizes live.
  console.warn(
    `[pregenerate] skipped: ${err instanceof Error ? err.message : String(err)}`,
  );
});
