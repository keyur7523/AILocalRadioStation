import { buildBreakPhrase } from './announcements';
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

describe('buildBreakPhrase', () => {
  const played = { title: 'Daydream', artist: 'RINZO' };
  const next = { title: '7AM', artist: 'Sculpture' };

  it('back-announces, gives the time, then teases the next track', () => {
    expect(
      buildBreakPhrase({
        justPlayed: played,
        nextUp: next,
        clock: '3:42 PM',
        seed: 0,
      }),
    ).toBe(
      "That was Daydream by RINZO. Right now it's 3:42 PM, and we've got plenty " +
        'more music coming your way. Next up, 7AM by Sculpture.',
    );
  });

  it('rotates templates so the DJ does not repeat itself', () => {
    expect(
      buildBreakPhrase({
        justPlayed: played,
        nextUp: next,
        clock: '3:42 PM',
        seed: 1,
      }),
    ).toBe(
      "You just heard Daydream from RINZO. It's 3:42 PM. Stay right here for " +
        "more music. Now let's listen to 7AM by Sculpture.",
    );
  });

  it('omits the artist when it is unknown', () => {
    expect(
      buildBreakPhrase({
        justPlayed: { title: 'Daydream' },
        clock: '1:00 AM',
        seed: 0,
      }),
    ).toContain('That was Daydream.');
  });

  it('still gives the time when nothing can be announced', () => {
    expect(buildBreakPhrase({ clock: '9:05 PM' })).toBe('The time is 9:05 PM.');
  });

  it('keeps the time check on an intro-only break', () => {
    const phrase = buildBreakPhrase({ nextUp: next, clock: '9:05 PM' });
    expect(phrase).toContain('The time is 9:05 PM.');
    expect(phrase).toContain('Next up, 7AM by Sculpture.');
  });
});
