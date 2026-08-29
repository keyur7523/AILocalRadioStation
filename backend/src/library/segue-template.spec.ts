import { renderSegue, splitForCaching } from './segue-template';

describe('renderSegue', () => {
  const values = {
    songName: 'Daydream',
    artistName: 'RINZO',
    time: '3:42 PM',
  };

  it('fills every placeholder', () => {
    expect(
      renderSegue(
        "That was [SONG NAME] by [ARTIST NAME]. It's [TIME].",
        values,
      ),
    ).toBe("That was Daydream by RINZO. It's 3:42 PM.");
  });

  it('is case-insensitive about placeholder names', () => {
    expect(renderSegue('Next up, [song name].', values)).toBe(
      'Next up, Daydream.',
    );
  });

  it('drops a dangling connector when the artist is unknown', () => {
    expect(
      renderSegue('That was [SONG NAME] by [ARTIST NAME].', {
        ...values,
        artistName: null,
      }),
    ).toBe('That was Daydream.');
  });

  it('leaves text with no placeholders alone', () => {
    expect(renderSegue('You are listening to the station.', values)).toBe(
      'You are listening to the station.',
    );
  });
});

describe('splitForCaching', () => {
  it('splits into sentences so each caches on its own', () => {
    expect(
      splitForCaching(
        "That was Daydream by RINZO. It's 3:42 PM. Next up, 7AM by Sculpture.",
      ),
    ).toEqual([
      'That was Daydream by RINZO.',
      "It's 3:42 PM.",
      'Next up, 7AM by Sculpture.',
    ]);
  });

  it('keeps the track sentence free of the clock, so it caches forever', () => {
    const [first] = splitForCaching(
      "That was Daydream by RINZO. It's 3:42 PM.",
    );
    expect(first).not.toMatch(/\d{1,2}:\d{2}/);
  });

  it('handles a single sentence', () => {
    expect(splitForCaching('Next up, Daydream.')).toEqual([
      'Next up, Daydream.',
    ]);
  });
});
