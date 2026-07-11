// Independent uptime checker for the AI Local Radio status page.
//
// Runs on GitHub Actions (NOT on Render), pings the public endpoints, and
// writes two files that the static page reads:
//   data/status.json   — the current snapshot (components + overall)
//   data/history.json  — per-day uptime buckets for the 90-day bars
//
// History persists with ZERO git commits: each run fetches the previously
// published history from the live Pages site, appends today's result, and the
// workflow redeploys. Nothing is committed to the repo, so Render never
// redeploys because of the status checker.

import { writeFile, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const DATA_DIR = join(dirname(fileURLToPath(import.meta.url)), 'data');

const BACKEND =
  process.env.STATUS_BACKEND_URL ??
  'https://ailocalradiostation-backend.onrender.com';
const FRONTEND = process.env.STATUS_FRONTEND_URL ?? ''; // set to enable "Player"
const PAGES_URL = process.env.STATUS_PAGES_URL ?? ''; // e.g. https://user.github.io/repo

const TIMEOUT_MS = 25000; // Render free tier can cold-start slowly
const DEGRADED_MS = 8000; // slower than this reads as degraded
const DAYS = 90;

/** The components shown on the page, each with how to verify it. */
const COMPONENTS = [
  { id: 'stream', name: 'Live Stream', kind: 'stream', url: `${BACKEND}/stream` },
  { id: 'api', name: 'Broadcast API', kind: 'health', url: `${BACKEND}/health` },
  { id: 'engine', name: 'Audio Engine', kind: 'station', url: `${BACKEND}/station` },
];
if (FRONTEND) {
  COMPONENTS.push({ id: 'player', name: 'Player', kind: 'web', url: FRONTEND });
}

async function timedFetch(url, opts = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  const start = Date.now();
  try {
    const res = await fetch(url, { ...opts, signal: ctrl.signal, redirect: 'follow' });
    return { res, ms: Date.now() - start };
  } finally {
    clearTimeout(timer);
  }
}

const ok = (c, ms, extra = {}) => ({
  id: c.id,
  name: c.name,
  status: ms > DEGRADED_MS ? 'degraded' : 'operational',
  message: ms > DEGRADED_MS ? 'Elevated latency' : '',
  latencyMs: ms,
  ...extra,
});
const down = (c, message, ms) => ({
  id: c.id,
  name: c.name,
  status: 'down',
  message,
  latencyMs: ms,
});

async function checkComponent(c) {
  try {
    const { res, ms } = await timedFetch(c.url);
    if (!res.ok) return down(c, `HTTP ${res.status}`, ms);

    if (c.kind === 'stream') {
      const type = res.headers.get('content-type') ?? '';
      if (!type.includes('audio')) return down(c, `unexpected type ${type}`, ms);
      const reader = res.body.getReader();
      const { value } = await reader.read();
      await reader.cancel();
      if (!value || value.length === 0) return down(c, 'no audio data', ms);
      return ok(c, ms);
    }
    if (c.kind === 'health') {
      const body = await res.json().catch(() => ({}));
      return body.status === 'ok' ? ok(c, ms) : down(c, 'unhealthy', ms);
    }
    if (c.kind === 'station') {
      const body = await res.json().catch(() => ({}));
      return body.online
        ? ok(c, ms, { listeners: body.listeners ?? 0 })
        : down(c, 'engine offline', ms);
    }
    return ok(c, ms); // plain web check
  } catch (err) {
    return down(c, err.name === 'AbortError' ? 'timeout' : 'unreachable', TIMEOUT_MS);
  }
}

async function loadPreviousHistory() {
  if (!PAGES_URL) return { daily: {} };
  try {
    const res = await fetch(`${PAGES_URL}/data/history.json`, {
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) return { daily: {} };
    const prev = await res.json();
    return prev && typeof prev === 'object' && prev.daily ? prev : { daily: {} };
  } catch {
    return { daily: {} };
  }
}

function recordDay(daily, id, wasUp) {
  const day = new Date().toISOString().slice(0, 10);
  const forId = (daily[id] ??= {});
  const bucket = (forId[day] ??= { up: 0, total: 0 });
  bucket.total += 1;
  if (wasUp) bucket.up += 1;
  // Keep only the most recent DAYS days.
  for (const key of Object.keys(forId).sort().slice(0, -DAYS)) delete forId[key];
}

async function main() {
  // Warm the backend first so we measure steady-state latency, not a Render
  // free-tier cold start (which would otherwise flag every post-idle check as
  // degraded). The warm-up result is intentionally ignored.
  try {
    await fetch(`${BACKEND}/health`, { signal: AbortSignal.timeout(40000) });
  } catch {
    /* if this fails the real checks below will report it */
  }

  const components = [];
  for (const c of COMPONENTS) components.push(await checkComponent(c));

  const overall = components.some((c) => c.status === 'down')
    ? 'down'
    : components.some((c) => c.status === 'degraded')
      ? 'degraded'
      : 'operational';

  const snapshot = { updatedAt: new Date().toISOString(), overall, components };

  const { daily } = await loadPreviousHistory();
  for (const c of components) recordDay(daily, c.id, c.status !== 'down');
  recordDay(daily, 'overall', overall !== 'down');

  await mkdir(DATA_DIR, { recursive: true });
  await writeFile(join(DATA_DIR, 'status.json'), JSON.stringify(snapshot, null, 2));
  await writeFile(join(DATA_DIR, 'history.json'), JSON.stringify({ daily }));

  console.log(
    `overall=${overall} | ` +
      components.map((c) => `${c.id}:${c.status}(${c.latencyMs}ms)`).join(' '),
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
