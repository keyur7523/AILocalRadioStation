import { join } from 'node:path';

/**
 * Central configuration for the broadcast engine.
 *
 * Phase I keeps this intentionally small: where the music lives, how loud/clean
 * the encode is, and the station's on-air identity. Later phases (scheduler,
 * DJ, weather/news) will grow this into a proper config module.
 */
export interface StreamConfig {
  /** Absolute path to the folder of .mp3 files that make up the rotation. */
  mediaDir: string;
  /** Constant output bitrate, e.g. "128k". A CBR stream keeps listeners in sync. */
  bitrate: string;
  /** Output sample rate in Hz. */
  sampleRate: number;
  /** Delay (ms) before relaunching ffmpeg if it exits unexpectedly. */
  restartDelayMs: number;
  /** On-air identity, surfaced to the player UI and as ICY stream headers. */
  station: {
    name: string;
    frequency: string;
    tagline: string;
    city: string;
  };
}

export function loadStreamConfig(): StreamConfig {
  return {
    mediaDir: process.env.MEDIA_DIR
      ? process.env.MEDIA_DIR
      : join(process.cwd(), 'media'),
    bitrate: process.env.STREAM_BITRATE ?? '128k',
    sampleRate: Number(process.env.STREAM_SAMPLE_RATE ?? 44100),
    restartDelayMs: Number(process.env.STREAM_RESTART_DELAY_MS ?? 1000),
    station: {
      name: process.env.STATION_NAME ?? 'KIND FM',
      frequency: process.env.STATION_FREQUENCY ?? '98.7',
      tagline: process.env.STATION_TAGLINE ?? 'your local sound, on a loop',
      city: process.env.STATION_CITY ?? 'Anytown',
    },
  };
}
