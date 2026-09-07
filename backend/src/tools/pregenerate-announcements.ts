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
import '../load-env';
import { spawn } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { staticSegmentsFor } from '../stream/dj/announcements';
import { buildTrackInfo } from '../stream/dj/track-info';
import { loadStreamConfig } from '../stream/stream.config';
import { EspeakTtsService } from '../stream/tts/espeak-tts.service';
import { PiperTtsService } from '../stream/tts/piper-tts.service';
import { discoverVoices } from '../stream/tts/voices';

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

  // Collect the clock-free lines once, then render them in EVERY installed
  // voice. Switching voices in the admin then costs nothing at run time.
  const phrases: string[] = [];
  for (const path of tracks) {
    const info = buildTrackInfo(await readTags(ffprobePath, path), path);
    if (!info) {
      console.log(`[pregenerate] ${path}: no usable metadata — skipping`);
      continue;
    }
    phrases.push(...staticSegmentsFor(info));
  }

  // Cheapest first: espeak, then `medium` models, then `high`. If the budget
  // below runs out it is the expensive voices that go uncached, and those are
  // the ones least likely to be on air on a small instance.
  const cost = (id: string) =>
    id === 'espeak' ? 0 : id.endsWith('-high') ? 2 : 1;
  const voices = discoverVoices(dj.voicesDir).sort(
    (a, b) => cost(a.id) - cost(b.id),
  );
  console.log(
    `[pregenerate] ${phrases.length} phrase(s) x ${voices.length} voice(s) -> ${dj.cacheDir}`,
  );

  // Bounded on purpose: this runs inside the image build, and a slow neural
  // voice can take longer per clip than the clip lasts. Blowing the build
  // timeout would fail the deploy outright, which is far worse than a voice
  // that has to synthesize its first few lines live.
  const budgetMs = Math.max(
    0,
    Number(process.env.DJ_PREGENERATE_BUDGET_MS ?? 240000),
  );
  const deadline = Date.now() + budgetMs;
  let made = 0;
  let failed = 0;
  let ranOut = false;
  for (const voice of voices) {
    if (Date.now() > deadline) {
      ranOut = true;
      break;
    }
    const tts =
      voice.engine === 'espeak'
        ? new EspeakTtsService(dj.cacheDir)
        : new PiperTtsService(dj.cacheDir, voice.modelPath ?? '');
    console.log(`[pregenerate] voice ${voice.id} (${voice.engine})`);
    // Sequential on purpose: a neural voice holds its model while it runs.
    for (const text of phrases) {
      if (Date.now() > deadline) {
        ranOut = true;
        break;
      }
      try {
        await tts.synthesize(text);
        made += 1;
      } catch (err) {
        failed += 1;
        console.warn(`[pregenerate]   x "${text}": ${(err as Error).message}`);
      }
    }
  }
  console.log(
    `[pregenerate] done — ${made} clip(s) cached` +
      (failed ? `, ${failed} failed` : '') +
      (ranOut ? ` (time budget reached; the rest synthesize live)` : ''),
  );
}

main().catch((err: unknown) => {
  // Never break the build over this; the station just synthesizes live.
  console.warn(
    `[pregenerate] skipped: ${err instanceof Error ? err.message : String(err)}`,
  );
});
