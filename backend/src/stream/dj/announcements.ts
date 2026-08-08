/**
 * What the DJ says at a break: back-announce the track that just finished, give
 * the time, and tease the one coming up.
 *
 * The phrase is built as **separate segments** rather than one string, because
 * each is cached independently by the TTS layer:
 *
 * - the back-announce and the tease name tracks, so they're identical every time
 *   that track comes round — synthesized once, then cache hits forever;
 * - only the time segment changes, once a minute, and it's the same text for
 *   every break in that minute so it can be pre-warmed.
 *
 * Synthesizing the whole sentence as one string would make it unique per
 * (track, minute) and force a fresh, slow synthesis at every single break.
 *
 * Pure string building — no I/O — so the phrasing is easy to unit test.
 */
import type { TrackInfo } from './track-info';

/** `"Daydream by RINZO"`, or just the title when the artist is unknown. */
function by(track: TrackInfo): string {
  return track.artist ? `${track.title} by ${track.artist}` : track.title;
}

/** Same, with "from" — reads better in some phrasings. */
function from(track: TrackInfo): string {
  return track.artist ? `${track.title} from ${track.artist}` : track.title;
}

/** Back-announcements (static per track). */
const OUTROS: ((track: TrackInfo) => string)[] = [
  (t) => `That was ${by(t)}.`,
  (t) => `You just heard ${from(t)}.`,
];

/** Time checks (change once a minute; identical across breaks in that minute). */
const TIMES: ((clock: string) => string)[] = [
  (clock) =>
    `Right now it's ${clock}, and we've got plenty more music coming your way.`,
  (clock) => `It's ${clock}. Stay right here for more music.`,
];

/** Teases for the track about to play (static per track). */
const INTROS: ((track: TrackInfo) => string)[] = [
  (t) => `Next up, ${by(t)}.`,
  (t) => `Now let's listen to ${by(t)}.`,
];

export interface BreakContext {
  /** The track that just finished, if it had usable metadata. */
  justPlayed?: TrackInfo | null;
  /** The track about to play, if it had usable metadata. */
  nextUp?: TrackInfo | null;
  /** Local wall-clock string to speak, e.g. `"3:42 PM"`. */
  clock: string;
  /** Rotates the templates so the DJ doesn't repeat itself. */
  seed?: number;
}

const pick = <T>(list: T[], seed: number): T =>
  list[Math.abs(seed) % list.length];

/** The time sentence alone — what the per-minute cache warmer pre-synthesizes. */
export function timeSegment(clock: string, seed = 0): string {
  return pick(TIMES, seed)(clock);
}

/**
 * Every line this track can produce that has no clock in it — i.e. everything
 * that is identical each time the track comes round. Synthesizing these ahead
 * of time (see `tools/pregenerate-announcements.ts`) means the DJ never has to
 * generate them live, which matters a lot on a small CPU.
 */
export function staticSegmentsFor(track: TrackInfo): string[] {
  return [...OUTROS.map((f) => f(track)), ...INTROS.map((f) => f(track))];
}

/**
 * Compose one DJ break as ordered segments, played back to back. Degrades
 * gracefully: with no track metadata it's just the time check, so the DJ always
 * has something to say.
 */
export function buildBreakSegments({
  justPlayed,
  nextUp,
  clock,
  seed = 0,
}: BreakContext): string[] {
  const segments: string[] = [];
  if (justPlayed) segments.push(pick(OUTROS, seed)(justPlayed));
  segments.push(timeSegment(clock, seed));
  if (nextUp) segments.push(pick(INTROS, seed)(nextUp));
  return segments;
}
