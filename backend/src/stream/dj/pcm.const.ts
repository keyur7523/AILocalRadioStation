/**
 * The single raw-audio contract shared by the persistent encoder and every
 * per-item decoder. Both sides MUST agree, or audio pitch/speed corrupts.
 * The sample rate comes from config (`sampleRate`) so it stays in one place too.
 */
export const PCM = {
  /** ffmpeg raw format: signed 16-bit little-endian. */
  format: 's16le',
  /** Output channel count (stereo). */
  channels: 2,
} as const;
