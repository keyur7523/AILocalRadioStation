import {
  downloadArgs,
  explainFailure,
  importKey,
  inspectCookies,
  keyPart,
  listingTags,
  mergeTags,
  parseListing,
  sessionArgs,
  uploadKey,
  validateImportUrl,
} from './ytdlp';

describe('validateImportUrl', () => {
  it('accepts http and https links', () => {
    expect(validateImportUrl(' https://soundcloud.com/a/b ')).toBe(
      'https://soundcloud.com/a/b',
    );
    expect(validateImportUrl('http://archive.org/details/x')).toBe(
      'http://archive.org/details/x',
    );
  });

  it.each([
    ['file:///etc/passwd'],
    ['ftp://example.com/song.mp3'],
    ['javascript:alert(1)'],
  ])('refuses %s — yt-dlp would read local files or other schemes', (url) => {
    expect(() => validateImportUrl(url)).toThrow(/http and https/);
  });

  it('refuses things that are not links', () => {
    expect(() => validateImportUrl('')).toThrow(/Paste a link/);
    expect(() => validateImportUrl(42)).toThrow(/Paste a link/);
    expect(() => validateImportUrl('not a url')).toThrow(/not a web address/);
    expect(() =>
      validateImportUrl('https://x.com/' + 'a'.repeat(2100)),
    ).toThrow(/too long/);
  });
});

describe('keys', () => {
  it('reduces text to safe key characters', () => {
    expect(keyPart('Rádio São Paulo — Live!')).toBe('radio-sao-paulo-live');
    expect(keyPart('../../etc')).toBe('etc');
    expect(keyPart('***')).toBe('track');
  });

  it('names link imports by source and id, so a re-import is recognised', () => {
    expect(importKey('Youtube', 'dQw4w9WgXcQ')).toBe(
      'imports/youtube-dqw4w9wgxcq.mp3',
    );
    expect(importKey('Youtube', 'dQw4w9WgXcQ')).toBe(
      importKey('Youtube', 'dQw4w9WgXcQ'),
    );
  });

  it('names uploads by file name and content fingerprint', () => {
    expect(uploadKey('My Song (final).MP3', 'abcdef0123456789')).toBe(
      'uploads/my-song-final-abcdef01.mp3',
    );
  });

  it('never produces a key that leaves its folder', () => {
    for (const key of [
      importKey('../', '../../x'),
      uploadKey('../../../evil.mp3', 'deadbeefdeadbeef'),
    ]) {
      expect(key).not.toMatch(/\.\./);
      expect(key.split('/')).toHaveLength(2);
    }
  });
});

describe('downloadArgs', () => {
  const args = downloadArgs({
    url: 'https://soundcloud.com/a/b',
    outDir: '/tmp/job',
    maxFileMb: 50,
  });

  it('fetches one tagged MP3 within the size limit', () => {
    expect(args).toEqual(
      expect.arrayContaining([
        '--no-playlist',
        '--embed-metadata',
        '--max-filesize',
        '50M',
      ]),
    );
    expect(args[args.indexOf('--audio-format') + 1]).toBe('mp3');
  });

  it('passes the link last, as a plain argument', () => {
    expect(args[args.length - 1]).toBe('https://soundcloud.com/a/b');
  });

  it('only points yt-dlp at a custom ffmpeg when one is configured', () => {
    expect(args).not.toContain('--ffmpeg-location');
    expect(
      downloadArgs({
        url: 'https://x',
        outDir: '/t',
        maxFileMb: 1,
        ffmpegPath: '/opt/ffmpeg',
      }),
    ).toEqual(expect.arrayContaining(['--ffmpeg-location', '/opt/ffmpeg']));
  });
});

describe('explainFailure', () => {
  it('explains the bot check that YouTube shows servers', () => {
    expect(
      explainFailure(
        "ERROR: [youtube] abc: Sign in to confirm you're not a bot. Use --cookies",
      ),
    ).toMatch(/upload/i);
  });

  it('explains an oversized file', () => {
    expect(explainFailure('ERROR: File is larger than max-filesize')).toMatch(
      /larger than the import limit/,
    );
  });

  it('falls back to the last error line', () => {
    expect(explainFailure('WARNING: x\nERROR: something odd happened')).toBe(
      'something odd happened',
    );
  });
});

describe('track tags', () => {
  it('gives missing fields an empty default instead of "NA"', () => {
    const args = downloadArgs({ url: 'https://x', outDir: '/t', maxFileMb: 1 });
    const templates = args.filter((a) => a.includes(':%(meta_'));
    expect(templates).toHaveLength(2);
    for (const t of templates) expect(t).toMatch(/\|\)s:/);
  });

  it('reads the listing, preferring the music fields', () => {
    expect(
      listingTags({
        title: 'Krasavitse',
        track: 'Krasavitse',
        creator: 'Alexander Pushkin',
        uploader: 'info@librivox.org',
      }),
    ).toEqual({ title: 'Krasavitse', artist: 'Alexander Pushkin' });
  });

  it('never takes an email or a link as the artist', () => {
    expect(
      listingTags({ title: 'x', uploader: 'info@librivox.org' }).artist,
    ).toBeUndefined();
    expect(
      listingTags({ title: 'x', uploader: 'https://example.com' }).artist,
    ).toBeUndefined();
  });

  it('fills a file-name title and an "NA" artist from the listing', () => {
    // What a direct-file download from Internet Archive produced.
    const { tags, changed } = mergeTags(
      { title: 'alexander-pushkin-krasavitse', artist: 'NA' },
      { title: 'Krasavitse', artist: 'Alexander Pushkin' },
      'alexander-pushkin-krasavitse',
    );
    expect(tags).toEqual({ title: 'Krasavitse', artist: 'Alexander Pushkin' });
    expect(changed).toBe(true);
  });

  it("keeps the file's own tags when they are real", () => {
    const { tags, changed } = mergeTags(
      { title: 'Daydream', artist: 'RINZO' },
      { title: 'Daydream | NCS Release', artist: 'NCS' },
      'abc123',
    );
    expect(tags).toEqual({ title: 'Daydream', artist: 'RINZO' });
    expect(changed).toBe(false);
  });
});

describe('sessionArgs', () => {
  it('names Node explicitly, by path, so YouTube challenges can be solved', () => {
    expect(sessionArgs({ nodePath: '/usr/local/bin/node' })).toEqual([
      '--js-runtimes',
      'node:/usr/local/bin/node',
    ]);
  });

  it('adds cookies only when a file is given', () => {
    expect(sessionArgs({})).toEqual([]);
    expect(sessionArgs({ cookiesFile: '/tmp/c.txt' })).toEqual([
      '--cookies',
      '/tmp/c.txt',
    ]);
  });
});

describe('inspectCookies', () => {
  const row = (domain: string, name: string) =>
    [domain, 'TRUE', '/', 'TRUE', '1999999999', name, 'secret'].join('\t');

  it('counts YouTube and Google cookies in a Netscape file', () => {
    const text = [
      '# Netscape HTTP Cookie File',
      row('.youtube.com', 'SID'),
      `#HttpOnly_${row('.youtube.com', 'HSID')}`,
      row('.google.com', 'SAPISID'),
      row('.example.com', 'other'),
    ].join('\n');
    expect(inspectCookies(text)).toEqual({ netscape: true, youtube: 3 });
  });

  it('notices a file that is not in the Netscape format', () => {
    expect(inspectCookies('[{"name":"SID"}]').netscape).toBe(false);
  });

  it('does not count look-alike domains', () => {
    const text = ['# HTTP Cookie File', row('.notyoutube.com', 'x')].join('\n');
    expect(inspectCookies(text).youtube).toBe(0);
  });
});

describe('parseListing', () => {
  it('turns a playlist into tracks with stable keys, capped', () => {
    const listing = JSON.stringify({
      extractor_key: 'YoutubeTab',
      entries: [
        {
          id: 'aaa111',
          ie_key: 'Youtube',
          title: 'One',
          url: 'https://youtu.be/aaa111',
        },
        {
          id: 'bbb222',
          ie_key: 'Youtube',
          title: 'Two',
          url: 'https://youtu.be/bbb222',
        },
        {
          id: 'ccc333',
          ie_key: 'Youtube',
          title: 'Three',
          url: 'https://youtu.be/ccc333',
        },
      ],
    });
    const entries = parseListing(listing, 'https://x', 2);
    expect(entries.map((e) => e.key)).toEqual([
      'imports/youtube-aaa111.mp3',
      'imports/youtube-bbb222.mp3',
    ]);
    expect(entries[0]).toMatchObject({
      id: 'aaa111',
      extractor: 'Youtube',
      title: 'One',
    });
  });

  it('treats a single video as a one-track listing', () => {
    const entries = parseListing(
      JSON.stringify({
        id: 'zzz',
        extractor_key: 'Youtube',
        title: 'Solo',
        webpage_url: 'https://youtu.be/zzz',
      }),
      'https://fallback',
      25,
    );
    expect(entries).toHaveLength(1);
    expect(entries[0].url).toBe('https://youtu.be/zzz');
  });
});

describe('explainFailure with cookies', () => {
  const bot = "ERROR: [youtube] x: Sign in to confirm you're not a bot.";

  it('suggests adding cookies when none were used', () => {
    expect(explainFailure(bot)).toMatch(/Add YouTube cookies/);
  });

  it('suggests fresh cookies when they were used', () => {
    expect(explainFailure(bot, { cookies: true })).toMatch(/expired/);
  });

  it('recognises cookies YouTube has rotated out', () => {
    expect(
      explainFailure(
        'ERROR: The provided YouTube account cookies are no longer valid.',
      ),
    ).toMatch(/Export fresh ones/);
  });
});
