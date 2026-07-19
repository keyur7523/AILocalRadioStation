import { formatTimePhrase } from './time-announcer';

describe('time-announcer', () => {
  it('formats EDT (summer) time', () => {
    // 19:42 UTC → 15:42 EDT (UTC-4)
    const d = new Date('2026-07-18T19:42:00Z');
    expect(formatTimePhrase(d, 'America/New_York')).toBe(
      'The time is 3:42 PM.',
    );
  });

  it('formats EST (winter) time, DST-aware', () => {
    // 20:05 UTC → 15:05 EST (UTC-5)
    const d = new Date('2026-01-15T20:05:00Z');
    expect(formatTimePhrase(d, 'America/New_York')).toBe(
      'The time is 3:05 PM.',
    );
  });

  it('formats a non-US half-hour-offset timezone', () => {
    // 19:42 UTC → 01:12 next day IST (UTC+5:30)
    const d = new Date('2026-07-18T19:42:00Z');
    expect(formatTimePhrase(d, 'Asia/Kolkata')).toBe('The time is 1:12 AM.');
  });

  it('normalizes whitespace so the AM/PM separator is a plain space', () => {
    const d = new Date('2026-07-18T19:42:00Z');
    const phrase = formatTimePhrase(d, 'America/New_York');
    // U+00A0 (no-break) / U+202F (narrow no-break) — what ICU emits before AM/PM.
    expect(phrase).not.toMatch(/[\u00A0\u202F]/);
  });
});
