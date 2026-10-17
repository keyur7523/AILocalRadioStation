/**
 * The pure half of the sequencer: the ffmpeg command line for each kind of
 * item, and the reading of a silencedetect log into trim points. Nothing here
 * spawns a process or keeps state, so all of it can be tested directly.
 */
import { PCM } from './pcm.const';

/**
 * Where a track's *audible* content starts and how long it runs, once dead air
 * at the head/tail is skipped. `duration: null` means "play through to the end".
 */
export type Trim = { start: number; duration: number | null };

/** No trimming: play the file exactly as-is. */
export const NO_TRIM: Trim = { start: 0, duration: null };

/** How to detect dead air, and how much of it to deliberately keep. */
export type TrimOptions = {
  thresholdDb: number;
  minSilenceSec: number;
  /** Silence left at each edge so the cut doesn't sound abrupt. */
  padSec: number;
};

const QUIET = ['-hide_banner', '-loglevel', 'error'];

/** Every decoder ends the same way: raw PCM in the encoder's contract, on stdout. */
function pcmOut(sampleRate: number): string[] {
  return [
    '-f',
    PCM.format,
    '-ar',
    String(sampleRate),
    '-ac',
    String(PCM.channels),
    'pipe:1',
  ];
}

/**
 * `gapSec` seconds of silence, in the shared PCM contract. Generated flat-out;
 * the encoder's `-re` paces it to real wall-clock time like any other item.
 */
export function silenceArgs(sampleRate: number, gapSec: number): string[] {
  return [
    ...QUIET,
    '-f',
    'lavfi',
    '-i',
    `anullsrc=r=${sampleRate}:cl=stereo`,
    '-t',
    String(gapSec),
    ...pcmOut(sampleRate),
  ];
}

/**
 * Plain decode of one file to the shared PCM contract (encoder paces it).
 * `trim` skips dead air: `-ss` before `-i` seeks past the silent head, `-t`
 * caps the output so the silent tail is never emitted.
 */
export function plainArgs(
  path: string,
  sampleRate: number,
  trim: Trim = NO_TRIM,
): string[] {
  return [
    ...QUIET,
    ...(trim.start > 0 ? ['-ss', trim.start.toFixed(3)] : []),
    '-i',
    path,
    ...(trim.duration !== null ? ['-t', trim.duration.toFixed(3)] : []),
    '-vn',
    ...pcmOut(sampleRate),
  ];
}

/**
 * Decode several clips as one continuous item, joined end to end. A DJ break
 * is spoken as separate segments (so each caches independently); concatenating
 * them in a single decode keeps the break a single seamless unit on the
 * stream, with the natural pause each clip already carries between sentences.
 */
export function concatArgs(paths: string[], sampleRate: number): string[] {
  if (paths.length === 1) return plainArgs(paths[0], sampleRate);
  const labels = paths.map((_, i) => `[${i}:a]`).join('');
  return [
    ...QUIET,
    ...paths.flatMap((p) => ['-i', p]),
    '-filter_complex',
    `${labels}concat=n=${paths.length}:v=0:a=1[out]`,
    '-map',
    '[out]',
    '-vn',
    ...pcmOut(sampleRate),
  ];
}

/**
 * Decode `song` with `clips` mixed over its tail: the voice is delayed to start
 * near the end, the music is ducked underneath it (sidechain compression), and
 * the voice is padded with silence to the song's length so the duck doesn't
 * truncate the song. Durations are probed by the caller.
 */
export function talkoverArgs(o: {
  song: string;
  clips: string[];
  /** The song's full length, before trimming. */
  rawSongSec: number;
  clipSecs: number[];
  trim: Trim;
  tailPadSec: number;
  sampleRate: number;
}): string[] {
  const { song, clips, trim, sampleRate: sr } = o;
  // Time the duck against the *audible* length, so the voice lands over the
  // real ending rather than over trimmed-away silence.
  const songDur = trim.duration ?? o.rawSongSec - trim.start;
  const clipDur = o.clipSecs.reduce((a, b) => a + b, 0);
  const startMs = Math.max(
    0,
    Math.round((songDur - clipDur - o.tailPadSec) * 1000),
  );
  const layout = `aformat=sample_rates=${sr}:channel_layouts=stereo`;
  // The break's segments are joined into one voice track before ducking.
  const voiceLabels = clips.map((_, i) => `[${i + 1}:a]`).join('');
  const joinVoice =
    clips.length > 1
      ? `${voiceLabels}concat=n=${clips.length}:v=0:a=1[voice];`
      : '';
  const voice = clips.length > 1 ? '[voice]' : '[1:a]';
  const graph =
    `[0:a]${layout}[music];` +
    joinVoice +
    `${voice}${layout},adelay=${startMs}|${startMs},apad=whole_dur=${songDur},asplit=2[vkey][vmix];` +
    `[music][vkey]sidechaincompress=threshold=0.015:ratio=10:attack=20:release=350[ducked];` +
    `[ducked][vmix]amix=inputs=2:normalize=0:dropout_transition=0[out]`;
  return [
    ...QUIET,
    ...(trim.start > 0 ? ['-ss', trim.start.toFixed(3)] : []),
    '-i',
    song,
    ...clips.flatMap((c) => ['-i', c]),
    ...(trim.duration !== null ? ['-t', trim.duration.toFixed(3)] : []),
    '-filter_complex',
    graph,
    '-map',
    '[out]',
    '-vn',
    ...pcmOut(sr),
  ];
}

/** The ffmpeg run whose stderr {@link trimFromSilence} reads. */
export function silenceDetectArgs(path: string, opts: TrimOptions): string[] {
  return [
    '-hide_banner',
    '-nostats',
    '-i',
    path,
    '-af',
    `silencedetect=noise=${opts.thresholdDb}dB:d=${opts.minSilenceSec}`,
    '-f',
    'null',
    '-',
  ];
}

/**
 * Trim points from ffmpeg's `silencedetect` log.
 *
 * Only silence touching the very start or very end is trimmed — a quiet
 * passage in the middle of a track is left alone. A trim that would leave
 * almost nothing (a near-silent file) is refused, so the file plays whole.
 */
export function trimFromSilence(
  log: string,
  duration: number,
  padSec: number,
): Trim {
  // Pair up "silence_start: X" / "silence_end: Y" lines in order.
  const periods: { start: number; end: number }[] = [];
  let open: number | null = null;
  for (const m of log.matchAll(/silence_(start|end):\s*(-?[\d.]+)/g)) {
    const value = Number.parseFloat(m[2]);
    if (!Number.isFinite(value)) continue;
    if (m[1] === 'start') open = value;
    else if (open !== null) {
      periods.push({ start: open, end: value });
      open = null;
    }
  }
  // A silence still open at EOF runs to the end of the file.
  if (open !== null) periods.push({ start: open, end: duration });

  const EDGE_TOL = 0.15; // treat "within 150ms of the edge" as touching it
  const first = periods[0];
  const last = periods[periods.length - 1];
  const rawStart = first && first.start <= EDGE_TOL ? first.end : 0;
  const rawTailStart =
    last && last.end >= duration - EDGE_TOL ? last.start : null;

  // Keep `padSec` of the silence at each edge so the cut never sounds abrupt
  // (speech especially needs a beat before and after the phrase).
  const start = Math.max(0, rawStart - padSec);
  const padded = rawTailStart === null ? null : rawTailStart + padSec;
  // If the pad reaches the end there's nothing left worth trimming.
  const tailStart = padded !== null && padded < duration - 0.02 ? padded : null;

  const audible = (tailStart ?? duration) - start;
  if (!Number.isFinite(audible) || audible < 0.3 || audible < duration * 0.1) {
    return NO_TRIM;
  }
  return { start, duration: tailStart === null ? null : audible };
}
