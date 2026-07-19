/**
 * Pure time-formatting helper for the DJ time-check.
 *
 * No I/O, no ffmpeg, no TTS — just turns a moment + timezone into the phrase the
 * DJ speaks. Trivially unit-testable. Because the phrase only changes once per
 * minute, the TTS layer's content-addressed cache (keyed on this string)
 * synthesizes a given time-check at most once per minute.
 */

/**
 * The DJ's spoken phrase for a given moment and IANA timezone.
 * e.g. `formatTimePhrase(date, 'America/New_York')` → `"The time is 3:42 PM."`
 */
export function formatTimePhrase(now: Date, timeZone: string): string {
  return `The time is ${formatClock(now, timeZone)}.`;
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
