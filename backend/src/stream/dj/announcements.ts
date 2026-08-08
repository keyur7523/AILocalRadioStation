/**
 * What the DJ says at a break: back-announce the track that just finished, give
 * the time, and tease the one coming up. Pure string building — no I/O — so the
 * phrasing is easy to unit test and to extend with new templates.
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

/** Back-announcements, which also carry the time check. */
const OUTROS: ((track: TrackInfo, clock: string) => string)[] = [
  (t, clock) =>
    `That was ${by(t)}. Right now it's ${clock}, and we've got plenty more music coming your way.`,
  (t, clock) =>
    `You just heard ${from(t)}. It's ${clock}. Stay right here for more music.`,
];

/** Teases for the track about to play. */
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

/**
 * Compose one DJ break. Falls back gracefully: with no track metadata at all it
 * degrades to the plain time check, so the DJ always has something to say.
 */
export function buildBreakPhrase({
  justPlayed,
  nextUp,
  clock,
  seed = 0,
}: BreakContext): string {
  const parts: string[] = [];

  if (justPlayed) {
    parts.push(OUTROS[Math.abs(seed) % OUTROS.length](justPlayed, clock));
  }
  if (nextUp) {
    parts.push(INTROS[Math.abs(seed) % INTROS.length](nextUp));
  }
  // Nothing to announce, or an intro-only break: make sure the time still lands.
  if (!justPlayed) {
    parts.unshift(`The time is ${clock}.`);
  }
  return parts.join(' ');
}
