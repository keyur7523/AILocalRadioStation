#!/usr/bin/env node
// Populate a LOCAL media folder from an audio playlist, for local testing/POC.
//
// Requires `yt-dlp` on PATH (pip install yt-dlp / brew install yt-dlp) and
// ffmpeg. Downloads each item's audio as an mp3, numbered so play order is
// stable, into an output dir (default `media-local/`, which is git-ignored).
//
// ⚠️ LICENSING: the public GET /stream RE-BROADCASTS this audio to anyone, so
// only stream music you're licensed to (Creative Commons, royalty-free, the
// YouTube Audio Library, or your own). Copyrighted tracks fetched here are for
// LOCAL testing only — the output dir is git-ignored and must NOT be deployed.
//
// Usage:  node scripts/fetch-playlist.mjs "<playlist-url>" [outputDir]
//   then: MEDIA_DIR=<outputDir> npm run start:dev

import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';

const url = process.argv[2];
const outArg = process.argv[3] ?? 'media-local';

if (!url) {
  console.error(
    'Usage: node scripts/fetch-playlist.mjs "<playlist-url>" [outputDir]',
  );
  process.exit(1);
}

const outDir = isAbsolute(outArg) ? outArg : join(process.cwd(), outArg);
mkdirSync(outDir, { recursive: true });

const ytdlp = process.env.YTDLP ?? 'yt-dlp';
const args = [
  '-x', // extract audio
  '--audio-format',
  'mp3',
  '--audio-quality',
  '0',
  // Capture title/artist INTO the file at import time — at play time the engine
  // only has a path, and the DJ needs these to announce the track. Prefer the
  // real music fields, falling back to the video title / uploader.
  '--embed-metadata',
  '--parse-metadata',
  '%(track,title)s:%(meta_title)s',
  '--parse-metadata',
  '%(artist,uploader)s:%(meta_artist)s',
  '--no-playlist-reverse',
  '--ignore-errors', // skip items that can't be fetched (e.g. embedding off)
  '-o',
  join(outDir, '%(playlist_index)02d-%(title)s.%(ext)s'),
  url,
];

console.log(`Fetching audio → ${outDir}`);
console.log(
  '⚠️  Local testing only — do not deploy copyrighted tracks to the public stream.\n',
);

const proc = spawn(ytdlp, args, { stdio: 'inherit' });
proc.on('error', (err) => {
  console.error(
    `\nCould not run yt-dlp (${err.message}).\n` +
      'Install it first:  pip install yt-dlp   (or)  brew install yt-dlp',
  );
  process.exit(1);
});
proc.on('close', (code) => {
  if (code === 0) {
    console.log(`\nDone. Play them locally with:\n  MEDIA_DIR=${outDir} npm run start:dev`);
  }
  process.exit(code ?? 0);
});
