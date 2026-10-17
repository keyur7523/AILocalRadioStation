import {
  NO_TRIM,
  concatArgs,
  plainArgs,
  silenceArgs,
  talkoverArgs,
  trimFromSilence,
} from './decoder-args';

const PCM_OUT = ['-f', 's16le', '-ar', '44100', '-ac', '2', 'pipe:1'];
const QUIET = ['-hide_banner', '-loglevel', 'error'];

describe('decoder commands', () => {
  it('generates the gap as timed silence', () => {
    expect(silenceArgs(44100, 0.5)).toEqual([
      ...QUIET,
      '-f',
      'lavfi',
      '-i',
      'anullsrc=r=44100:cl=stereo',
      '-t',
      '0.5',
      ...PCM_OUT,
    ]);
  });

  it('decodes a song whole when there is nothing to trim', () => {
    expect(plainArgs('/m/a.mp3', 44100)).toEqual([
      ...QUIET,
      '-i',
      '/m/a.mp3',
      '-vn',
      ...PCM_OUT,
    ]);
  });

  it('seeks past the silent head and stops before the silent tail', () => {
    expect(plainArgs('/m/a.mp3', 44100, { start: 1.5, duration: 180 })).toEqual(
      [
        ...QUIET,
        '-ss',
        '1.500',
        '-i',
        '/m/a.mp3',
        '-t',
        '180.000',
        '-vn',
        ...PCM_OUT,
      ],
    );
  });

  it('joins a multi-part break into one decode, and plays a single part plainly', () => {
    const args = concatArgs(['/c/1.wav', '/c/2.wav'], 44100);
    expect(args).toEqual(
      expect.arrayContaining(['-i', '/c/1.wav', '-i', '/c/2.wav']),
    );
    expect(args[args.indexOf('-filter_complex') + 1]).toBe(
      '[0:a][1:a]concat=n=2:v=0:a=1[out]',
    );
    expect(args.slice(-PCM_OUT.length)).toEqual(PCM_OUT);
    expect(concatArgs(['/c/1.wav'], 44100)).toEqual(
      plainArgs('/c/1.wav', 44100),
    );
  });

  it('starts the voice so it ends a tail pad before the audible end', () => {
    const args = talkoverArgs({
      song: '/m/a.mp3',
      clips: ['/c/1.wav', '/c/2.wav'],
      rawSongSec: 200,
      clipSecs: [3, 2],
      trim: { start: 1, duration: 190 },
      tailPadSec: 0.5,
      sampleRate: 44100,
    });
    const graph = args[args.indexOf('-filter_complex') + 1];
    // 190s audible − 5s of voice − 0.5s pad = 184.5s
    expect(graph).toContain('adelay=184500|184500');
    expect(graph).toContain('apad=whole_dur=190');
    expect(graph).toContain('[1:a][2:a]concat=n=2:v=0:a=1[voice]');
    expect(args.slice(0, 7)).toEqual([
      ...QUIET,
      '-ss',
      '1.000',
      '-i',
      '/m/a.mp3',
    ]);
  });
});

describe('trimFromSilence', () => {
  const log = (...pairs: [number, number | null][]) =>
    pairs
      .map(
        ([s, e]) =>
          `[silencedetect @ 0x1] silence_start: ${s}\n` +
          (e === null
            ? ''
            : `[silencedetect @ 0x1] silence_end: ${e} | silence_duration: ${e - s}\n`),
      )
      .join('');

  it('trims silence at both edges', () => {
    expect(trimFromSilence(log([0, 2], [178, 180]), 180, 0)).toEqual({
      start: 2,
      duration: 176,
    });
  });

  it('treats a silence still open at the end of the file as the tail', () => {
    expect(trimFromSilence(log([175, null]), 180, 0)).toEqual({
      start: 0,
      duration: 175,
    });
  });

  it('leaves quiet passages in the middle alone', () => {
    expect(trimFromSilence(log([60, 65]), 180, 0)).toEqual({
      start: 0,
      duration: null,
    });
  });

  it('keeps the pad of silence at each edge', () => {
    expect(trimFromSilence(log([0, 1], [9, 10]), 10, 0.12)).toEqual({
      start: 0.88,
      duration: expect.closeTo(8.24, 5) as number,
    });
  });

  it('plays a nearly silent file whole', () => {
    expect(trimFromSilence(log([0, 9.9]), 10, 0)).toBe(NO_TRIM);
  });

  it('reads an empty log as nothing to trim', () => {
    expect(trimFromSilence('', 180, 0)).toEqual({ start: 0, duration: null });
  });
});
