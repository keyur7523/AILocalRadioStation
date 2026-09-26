/**
 * The pure parts of importing: checking what the operator pasted, naming what
 * lands in the bucket, and the arguments handed to yt-dlp. Kept free of I/O so
 * the rules are easy to test and to read in one place.
 */

/** A link worth handing to yt-dlp, or an error saying why not. */
export function validateImportUrl(raw: unknown): string {
  if (typeof raw !== 'string' || !raw.trim()) {
    throw new Error('Paste a link to a playlist or a track');
  }
  const text = raw.trim();
  if (text.length > 2000) throw new Error('That link is too long');
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    throw new Error('That is not a web address');
  }
  // yt-dlp also understands local paths and other schemes; none of those
  // belong in a request from a web page.
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new Error('Only http and https links can be imported');
  }
  return url.toString();
}

/** Reduce free text to something safe inside an object key. */
export function keyPart(text: string, max = 60): string {
  const cleaned = text
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, max)
    .replace(/-+$/g, '');
  return cleaned || 'track';
}

/**
 * Where a track imported from a link is stored. Built from the source and its
 * id rather than the title, so importing the same playlist again recognises
 * what it already has and only fetches what is new.
 */
export function importKey(extractor: string, id: string): string {
  return `imports/${keyPart(extractor, 20)}-${keyPart(id, 40)}.mp3`;
}

/**
 * Where an uploaded file is stored: its name plus a fingerprint of its content,
 * so uploading the same file twice is recognised and not stored twice.
 */
export function uploadKey(originalName: string, sha1: string): string {
  const stem = originalName.replace(/\.[^.]+$/, '');
  return `uploads/${keyPart(stem)}-${sha1.slice(0, 8)}.mp3`;
}

/** Arguments to list what a link contains without downloading anything. */
export function listArgs(url: string, maxTracks: number): string[] {
  return [
    '--flat-playlist',
    '--dump-single-json',
    '--playlist-end',
    String(maxTracks),
    '--no-warnings',
    '--socket-timeout',
    '30',
    url,
  ];
}

/**
 * Arguments to fetch one track as a tagged MP3. The tags matter: at play time
 * the engine has only a file, and the DJ reads the title and artist from it.
 * The same choices as the local fetch-playlist script.
 */
export function downloadArgs(opts: {
  url: string;
  outDir: string;
  maxFileMb: number;
  ffmpegPath?: string;
}): string[] {
  const args = [
    '--no-playlist',
    '-x',
    '--audio-format',
    'mp3',
    '--audio-quality',
    '0',
    '--embed-metadata',
    // The trailing "|" gives each field an empty default. Without it yt-dlp
    // writes the literal text "NA" when a field is missing, and the DJ would
    // announce the track as being "by NA".
    '--parse-metadata',
    '%(track,title|)s:%(meta_title)s',
    '--parse-metadata',
    '%(artist,creator,uploader|)s:%(meta_artist)s',
    '--max-filesize',
    `${opts.maxFileMb}M`,
    '--socket-timeout',
    '30',
    '--no-progress',
    '--no-warnings',
    '-o',
    `${opts.outDir}/%(id)s.%(ext)s`,
    // Report where the finished file ended up, after conversion to MP3.
    '--print',
    'after_move:filepath',
  ];
  if (opts.ffmpegPath && opts.ffmpegPath !== 'ffmpeg') {
    args.push('--ffmpeg-location', opts.ffmpegPath);
  }
  args.push(opts.url);
  return args;
}

/**
 * A short, readable reason from yt-dlp's error output, for the operator rather
 * than for a developer.
 */
export function explainFailure(stderr: string): string {
  const text = stderr.toLowerCase();
  if (text.includes('confirm you') && text.includes('bot')) {
    return "The site refused the server (it asks for a sign-in to prove it isn't a bot). Try uploading the file instead.";
  }
  if (
    text.includes('larger than max-filesize') ||
    text.includes('file is larger')
  ) {
    return 'The file is larger than the import limit';
  }
  if (text.includes('private video') || text.includes('video unavailable')) {
    return 'The track is private or unavailable';
  }
  if (text.includes('unsupported url')) {
    return 'That site is not supported';
  }
  const last = stderr
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.startsWith('ERROR'))
    .pop();
  return (last ?? stderr.trim().split('\n').pop() ?? 'Unknown error')
    .replace(/^ERROR:\s*/, '')
    .slice(0, 200);
}

/** A title and artist, either of which may be unknown. */
export interface TrackTags {
  title?: string;
  artist?: string;
}

/** What the listing says about one entry, falling back to the playlist. */
export function listingTags(
  entry: Record<string, unknown>,
  playlist: Record<string, unknown> = {},
): TrackTags {
  const pick = (...values: unknown[]) =>
    values.find((v): v is string => typeof v === 'string' && isReal(v));
  return {
    title: pick(entry.track, entry.title),
    artist: pick(
      entry.artist,
      entry.creator,
      playlist.artist,
      playlist.creator,
      entry.channel,
      entry.uploader,
    ),
  };
}

/**
 * Fill in whatever the downloaded file came back without, from the listing.
 *
 * The file's own tags win when they are real: a video downloaded on its own
 * usually carries richer metadata than a playlist listing. But some sites hand
 * out direct file links, which yt-dlp downloads without any page to read, and
 * those arrive with a title that is just the file name and no artist at all.
 */
export function mergeTags(
  file: TrackTags,
  listing: TrackTags,
  fileStem: string,
): { tags: TrackTags; changed: boolean } {
  const fileTitle =
    isReal(file.title) && !isSlugOf(file.title!, fileStem)
      ? file.title
      : undefined;
  const fileArtist = isReal(file.artist) ? file.artist : undefined;
  const tags = {
    title: fileTitle ?? listing.title ?? file.title,
    artist: fileArtist ?? listing.artist,
  };
  return {
    tags,
    changed: tags.title !== file.title || tags.artist !== file.artist,
  };
}

/** A usable value: not empty, not yt-dlp's "NA", not an email or a link. */
function isReal(value: unknown): boolean {
  if (typeof value !== 'string') return false;
  const v = value.trim();
  return !!v && v !== 'NA' && !/^\S+@\S+$/.test(v) && !/^https?:\/\//i.test(v);
}

/** Whether a title is really just the file name it was downloaded as. */
function isSlugOf(title: string, stem: string): boolean {
  const norm = (t: string) => t.toLowerCase().replace(/[^a-z0-9]+/g, '');
  return !!stem && norm(title) === norm(stem);
}
