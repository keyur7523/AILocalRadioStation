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
export function explainFailure(
  stderr: string,
  opts: { cookies?: boolean } = {},
): string {
  const text = stderr.toLowerCase();
  if (
    text.includes('cookies are no longer valid') ||
    text.includes('cookies have been rotated')
  ) {
    return 'The YouTube sign-in cookies have expired. Export fresh ones and replace the cookies file.';
  }
  if (text.includes('confirm you') && text.includes('bot')) {
    return opts.cookies
      ? 'YouTube refused the server even with the sign-in cookies. They may have expired; export fresh ones, or upload the file instead.'
      : "The site refused the server (it asks for a sign-in to prove it isn't a bot). Add YouTube cookies, or upload the file instead.";
  }
  if (
    text.includes('n challenge') ||
    text.includes('no supported javascript runtime')
  ) {
    return "yt-dlp could not solve YouTube's challenge. Updating yt-dlp usually fixes this.";
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

/**
 * Arguments every yt-dlp call needs, whatever it is doing.
 *
 * YouTube serves some formats only to clients that solve a JavaScript
 * challenge, and yt-dlp uses only Deno for that unless told otherwise. The
 * server already runs on Node, so it is named explicitly — by absolute path, so
 * it is the same Node running this process. Cookies, when supplied, sign the
 * requests in, which is what gets past YouTube's check on data-centre IPs.
 */
export function sessionArgs(opts: {
  nodePath?: string;
  cookiesFile?: string;
}): string[] {
  const args: string[] = [];
  if (opts.nodePath) args.push('--js-runtimes', `node:${opts.nodePath}`);
  if (opts.cookiesFile) args.push('--cookies', opts.cookiesFile);
  return args;
}

/**
 * What a cookies file holds, without ever exposing its values: whether it is in
 * the Netscape format yt-dlp reads, and how many cookies belong to YouTube or
 * Google (the ones that matter for signing in).
 */
export function inspectCookies(text: string): {
  netscape: boolean;
  youtube: number;
} {
  const lines = text.split(/\r?\n/);
  const netscape = /^#\s*(Netscape )?HTTP Cookie File/i.test(lines[0] ?? '');
  const youtube = lines.filter((l) => {
    if (!l || (l.startsWith('#') && !l.startsWith('#HttpOnly_'))) return false;
    const domain = l.replace(/^#HttpOnly_/, '').split('\t')[0] ?? '';
    return /(^|\.)(youtube\.com|google\.com)$/.test(domain);
  }).length;
  return { netscape, youtube };
}

/** One track found at a link. */
export interface ListingEntry {
  id: string;
  /** Which site it came from, e.g. "Youtube". */
  extractor: string;
  title: string;
  /** The address to download this one track from. */
  url: string;
  /** Where it is stored when imported on the server. */
  key: string;
  tags: TrackTags;
}

/** Turn yt-dlp's listing of a link into the tracks to fetch, capped. */
export function parseListing(
  stdout: string,
  fallbackUrl: string,
  maxTracks: number,
): ListingEntry[] {
  let info: Record<string, unknown>;
  try {
    info = JSON.parse(stdout) as Record<string, unknown>;
  } catch {
    throw new Error('Could not read what that link contains');
  }
  const str = (v: unknown) => (typeof v === 'string' && v ? v : undefined);
  const site = str(info.extractor_key) ?? str(info.extractor) ?? 'web';
  const entries = Array.isArray(info.entries)
    ? (info.entries as Record<string, unknown>[])
    : [info];
  return entries
    .filter((e) => e && str(e.id))
    .slice(0, maxTracks)
    .map((e) => {
      const id = str(e.id)!;
      const extractor = str(e.ie_key) ?? site;
      return {
        id,
        extractor,
        title: str(e.title) ?? id,
        url:
          str(e.url) ??
          str(e.webpage_url) ??
          str(e.original_url) ??
          fallbackUrl,
        key: importKey(extractor, id),
        tags: listingTags(e, info),
      };
    });
}
