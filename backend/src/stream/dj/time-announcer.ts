/**
 * Pure time-formatting helpers for the DJ time-check.
 *
 * No I/O, no ffmpeg, no TTS — just turns a moment + timezone into the phrase the
 * DJ speaks, and a stable per-minute key used to cache the synthesized clip.
 * Trivially unit-testable.
 */

/**
 * The DJ's spoken phrase for a given moment and IANA timezone.
 * e.g. `formatTimePhrase(date, 'America/New_York')` → `"The time is 3:42 PM."`
 */
export function formatTimePhrase(now: Date, timeZone: string): string {
  return `The time is ${formatClock(now, timeZone)}.`;
}

/**
 * A stable per-minute key (the clock string, e.g. `"3:42 PM"`). Because it only
 * changes once per minute, using it as the TTS cache key means we synthesize a
 * given time-check at most once per minute and reuse it across rotations.
 */
export function minuteKey(now: Date, timeZone: string): string {
  return formatClock(now, timeZone);
}

/**
 * Format the local wall-clock time as `"3:42 PM"` in the given IANA timezone.
 * `Intl.DateTimeFormat` (full ICU in Node 22) handles DST correctly. Recent ICU
 * emits a narrow no-break space (U+202F) before AM/PM; we normalize all
 * whitespace to plain spaces so the string is clean for both tests and TTS.
 */
function formatClock(now: Date, timeZone: string): string {
  return new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  })
    .format(now)
    .replace(/\s+/g, ' ');
}
