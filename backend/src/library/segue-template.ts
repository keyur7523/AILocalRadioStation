/**
 * Turning a segue template into the lines the DJ actually speaks.
 *
 * Pure string work, so the placeholder rules are easy to test and to explain in
 * the admin panel.
 */

export interface SegueValues {
  /** Spoken form of the song title (its phonetic spelling if one is set). */
  songName?: string | null;
  /** Spoken form of the artist (likewise). */
  artistName?: string | null;
  /** Clock string, e.g. `"3:42 PM"`. */
  time?: string | null;
}

/** The placeholders a segue may contain, for the admin panel to advertise. */
export const PLACEHOLDERS = ['[TIME]', '[SONG NAME]', '[ARTIST NAME]'] as const;

/** Fill the placeholders. Unknown values collapse rather than leaving brackets. */
export function renderSegue(template: string, values: SegueValues): string {
  const filled = template
    .replace(/\[SONG NAME\]/gi, values.songName ?? '')
    .replace(/\[ARTIST NAME\]/gi, values.artistName ?? '')
    .replace(/\[TIME\]/gi, values.time ?? '');
  return tidy(filled);
}

/**
 * Clean up after a missing value — "That was Daydream by ." reads badly, so trim
 * the dangling connector and collapse the whitespace it leaves behind.
 */
function tidy(text: string): string {
  return (
    text
      // Drop a connector left stranded by a missing value ("by ." -> ".")
      .replace(/\b(by|from|with)\s*([,.!?])/gi, '$2')
      // ...then tidy the spacing it leaves behind. Order matters: collapsing
      // spaces first would strand one in front of the punctuation.
      .replace(/\s+([,.!?])/g, '$1')
      .replace(/\s{2,}/g, ' ')
      .replace(/([,.!?])\1+/g, '$1')
      .trim()
  );
}

/**
 * Split a rendered segue into the pieces that get synthesized separately.
 *
 * This is what keeps speech cheap: a sentence naming the track is identical
 * every time that track comes round, so it is synthesized once and cached
 * forever, while only the sentence carrying the clock changes each minute.
 * Synthesizing the whole segue as one string would make every break unique and
 * force a slow fresh render each time — which is what used to drop the DJ.
 */
export function splitForCaching(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
}
