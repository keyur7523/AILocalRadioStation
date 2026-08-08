import { buildBreakSegments, timeSegment } from './announcements';
import {
  buildTrackInfo,
  cleanForSpeech,
  titleFromFilename,
} from './track-info';

describe('track-info', () => {
  it('strips promo noise after a pipe', () => {
    expect(
      cleanForSpeech(
        'RINZO, MAHIRU - Daydream | J Pop | NCS - Copyright Free Music',
      ),
    ).toBe('RINZO, MAHIRU - Daydream');
  });

  it('strips bracketed tags like [FREE]', () => {
    expect(cleanForSpeech('[FREE] Lauv Type Beat')).toBe('Lauv Type Beat');
  });

  it('makes a filename speakable when there are no tags', () => {
    expect(titleFromFilename('/m/02-morninglightmusic-happy-pop.mp3')).toBe(
      'morninglightmusic happy pop',
    );
  });

  it('prefers tags over the filename', () => {
    const info = buildTrackInfo(
      { title: 'Daydream', artist: 'RINZO' },
      '/m/01-whatever.mp3',
    );
    expect(info).toEqual({ title: 'Daydream', artist: 'RINZO' });
  });

  it('drops an artist that just repeats the title', () => {
    const info = buildTrackInfo(
      { title: 'Daydream', artist: 'daydream' },
      '/m/x.mp3',
    );
    expect(info?.artist).toBeUndefined();
  });
});

describe('buildBreakSegments', () => {
  const played = { title: 'Daydream', artist: 'RINZO' };
  const next = { title: '7AM', artist: 'Sculpture' };

  it('splits into back-announce, time, and tease', () => {
    expect(
      buildBreakSegments({
        justPlayed: played,
        nextUp: next,
        clock: '3:42 PM',
        seed: 0,
      }),
    ).toEqual([
      'That was Daydream by RINZO.',
      "Right now it's 3:42 PM, and we've got plenty more music coming your way.",
      'Next up, 7AM by Sculpture.',
    ]);
  });

  it('rotates templates so the DJ does not repeat itself', () => {
    expect(
      buildBreakSegments({
        justPlayed: played,
        nextUp: next,
        clock: '3:42 PM',
        seed: 1,
      }),
    ).toEqual([
      'You just heard Daydream from RINZO.',
      "It's 3:42 PM. Stay right here for more music.",
      "Now let's listen to 7AM by Sculpture.",
    ]);
  });

  it('keeps the track segments free of the clock, so they cache forever', () => {
    const clock = /\d{1,2}:\d{2}/; // a spoken time like "3:42"
    const [outro, time, intro] = buildBreakSegments({
      justPlayed: played,
      nextUp: next,
      clock: '3:42 PM',
      seed: 0,
    });
    expect(outro).not.toMatch(clock);
    expect(intro).not.toMatch(clock); // "7AM" is a title, not a time
    expect(time).toMatch(clock); // only this segment changes per minute
  });

  it('omits the artist when it is unknown', () => {
    expect(
      buildBreakSegments({
        justPlayed: { title: 'Daydream' },
        clock: '1:00 AM',
        seed: 0,
      })[0],
    ).toBe('That was Daydream.');
  });

  it('still gives the time when nothing can be announced', () => {
    expect(buildBreakSegments({ clock: '9:05 PM', seed: 1 })).toEqual([
      "It's 9:05 PM. Stay right here for more music.",
    ]);
  });

  it('exposes the time sentence alone for pre-warming', () => {
    expect(timeSegment('9:05 PM', 1)).toBe(
      "It's 9:05 PM. Stay right here for more music.",
    );
  });
});
