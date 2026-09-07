/**
 * Load `backend/.env` into `process.env`, if there is one.
 *
 * `.env.example` has always told you to copy it to `.env`, but nothing actually
 * read the file: in production every value comes from the host's dashboard, so
 * the gap only showed up when running the tools locally.
 *
 * Node reads the file natively, so this needs no dependency. Import it FIRST —
 * before anything that reads `process.env` — and note that real environment
 * variables always win, so a value set by the host is never overwritten by a
 * stale local file.
 */
import { existsSync } from 'node:fs';
import { join } from 'node:path';

const path = join(process.cwd(), '.env');
if (existsSync(path)) {
  try {
    process.loadEnvFile(path);
  } catch (err) {
    console.warn(`Could not read .env: ${(err as Error).message}`);
  }
}
