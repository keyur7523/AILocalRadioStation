/**
 * List what the music bucket holds — a quick way to confirm credentials work
 * and to see what the station will pick up on its next start.
 *
 * Usage:  npm run media:list
 */
import '../load-env';
import { MediaStoreService } from '../media/media-store.service';
import { loadStreamConfig } from '../stream/stream.config';

async function main(): Promise<void> {
  const config = loadStreamConfig();
  const store = new MediaStoreService();
  const files = await store.list();
  console.log(
    store.usingRemote
      ? `Bucket "${config.r2.bucket}" holds ${files.length} track(s):`
      : `No bucket configured — showing ${config.mediaDir}:`,
  );
  for (const f of files) console.log(`  ${f}`);
}

main().catch((err: unknown) => {
  console.error(
    `List failed: ${err instanceof Error ? err.message : String(err)}`,
  );
  process.exitCode = 1;
});
