/**
 * Base URL of the Nest broadcast backend. Override with NEXT_PUBLIC_STREAM_BASE
 * (e.g. in production) — defaults to the local dev backend on port 3001.
 */
export const STREAM_BASE =
  process.env.NEXT_PUBLIC_STREAM_BASE ?? "http://localhost:3001";

export const STREAM_URL = `${STREAM_BASE}/stream`;
export const STATION_URL = `${STREAM_BASE}/station`;
