/**
 * Upload local .mp3 files into the music bucket.
 *
 * Import stays a local step — you fetch and tag tracks on your machine with
 * `npm run fetch:playlist`, listen to them, then push them here. The station
 * picks them up on its next start, with no redeploy and nothing committed to
 * the repo.
 *
 * Usage:  npm run media:push [-- <folder>]     (defaults to ./media)
 */
import '../load-env';
import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { MediaStoreService } from '../media/media-store.service';
import { loadStreamConfig } from '../stream/stream.config';

async function main(): Promise<void> {
  const config = loadStreamConfig();
  if (!config.r2.bucket) {
    console.error(
      'No bucket configured. Set R2_ACCOUNT_ID, R2_BUCKET, R2_ACCESS_KEY_ID\n' +
        'and R2_SECRET_ACCESS_KEY (a .env file works) and try again.',
    );
    process.exitCode = 1;
    return;
  }

  const dir = process.argv[2] ?? config.mediaDir;
  const files = readdirSync(dir).filter((f) =>
    f.toLowerCase().endsWith('.mp3'),
  );
  if (files.length === 0) {
    console.log(`No .mp3 files in ${dir}`);
    return;
  }

  const store = new MediaStoreService();
  // What the bucket already holds, so a re-run only sends what is missing.
  const existing = new Set(await store.list());

  console.log(
    `Pushing ${files.length} file(s) from ${dir} → ${config.r2.bucket}`,
  );
  let sent = 0;
  let skipped = 0;
  for (const file of files.sort()) {
    if (existing.has(file)) {
      console.log(`  = ${file} (already there)`);
      skipped += 1;
      continue;
    }
    const path = join(dir, file);
    const mb = (statSync(path).size / 1024 / 1024).toFixed(1);
    process.stdout.write(`  ↑ ${file} (${mb} MB) … `);
    await store.upload(path, file);
    console.log('done');
    sent += 1;
  }
  console.log(
    `Pushed ${sent} file(s)` + (skipped ? `, ${skipped} already present` : ''),
  );
}

main().catch((err: unknown) => {
  console.error(
    `Push failed: ${err instanceof Error ? err.message : String(err)}`,
  );
  process.exitCode = 1;
});
