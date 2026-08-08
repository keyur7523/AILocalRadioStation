/**
 * Turning a media file into something the DJ can say out loud.
 *
 * Track metadata is captured at **import time** (the fetch script embeds ID3
 * tags), because at play time all the engine has is a file path. These helpers
 * are pure — no I/O — so they're easy to unit test.
 */

export interface TrackInfo {
  title: string;
  artist?: string;
}

/**
 * Strip the promotional noise that rides along in uploaded titles so the DJ
 * doesn't read it aloud, e.g.
 * `"RINZO - Daydream | J Pop | NCS - Copyright Free Music"` → `"Daydream"`,
 * `"[FREE] Lauv Type Beat | Pop Type Beat - \"7AM\""` → `"Lauv Type Beat"`.
 */
export function cleanForSpeech(raw: string): string {
  let s = raw;
  s = s.split('|')[0]; // drop "| J Pop | NCS - Copyright Free Music" tails
  s = s.replace(/\[[^\]]*\]/g, ' '); // [FREE], [Official Video]
  s = s.replace(/\((?:official|lyric|audio|video|hd|4k)[^)]*\)/gi, ' ');
  s = s.replace(/["“”']/g, ' ');
  s = s.replace(/\s*[-–—]\s*$/, ''); // trailing dash left by the cuts above
  s = s.replace(/\s+/g, ' ').trim();
  return s;
}

/**
 * Last-resort title when a file carries no tags: make the filename speakable by
 * dropping the ordering prefix and turning separators into spaces.
 * `"01-morninglightmusic-happy-pop.mp3"` → `"morninglightmusic happy pop"`.
 */
export function titleFromFilename(path: string): string {
  const base = (path.split('/').pop() ?? path).replace(/\.[^.]+$/, '');
  return base
    .replace(/^\d+\s*[-_.]\s*/, '')
    .replace(/[-_]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Build the DJ's view of a track from its embedded tags, falling back to the
 * filename. Returns `null` when there's nothing worth announcing.
 */
export function buildTrackInfo(
  tags: { title?: string; artist?: string },
  path: string,
): TrackInfo | null {
  const title = cleanForSpeech(tags.title?.trim() || titleFromFilename(path));
  if (!title) return null;
  const artist = tags.artist ? cleanForSpeech(tags.artist) : undefined;
  // An artist identical to the title adds nothing ("Daydream by Daydream").
  return {
    title,
    artist:
      artist && artist.toLowerCase() !== title.toLowerCase()
        ? artist
        : undefined,
  };
}
