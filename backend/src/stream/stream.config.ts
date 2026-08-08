import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * Central configuration for the broadcast engine.
 *
 * Phase I keeps this intentionally small: where the music lives, how loud/clean
 * the encode is, and the station's on-air identity. Later phases (scheduler,
 * DJ, weather/news) will grow this into a proper config module.
 */
export interface StreamConfig {
  /**
   * Path to the ffmpeg binary. Defaults to `ffmpeg` on PATH (present in the
   * Docker image); override with FFMPEG_PATH if it lives elsewhere.
   */
  ffmpegPath: string;
  /** Path to the ffprobe binary (ships with ffmpeg); used to time talk-overs. */
  ffprobePath: string;
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
    /** IANA timezone the DJ announces local time in (DST-aware). */
    timeZone: string;
  };
  /** Trim dead air from the start/end of songs so the rotation sounds tight. */
  trim: {
    /** Master on/off. When false, songs play exactly as-is. */
    enabled: boolean;
    /** Level (dBFS) below which audio counts as silence, e.g. -50. */
    thresholdDb: number;
    /** Ignore silences shorter than this (seconds) — avoids clipping fades. */
    minSilenceSec: number;
    /**
     * Trimming for spoken DJ clips. Deliberately gentler than for music: TTS
     * engines leave a beat of silence around the phrase, but speech fades in
     * softly, so an aggressive trim clips the first consonant. A stricter
     * threshold plus a guard pad keeps the delivery natural, not clipped.
     */
    speech: {
      enabled: boolean;
      /** Stricter than music, so soft speech onsets aren't read as silence. */
      thresholdDb: number;
      /** Silence (seconds) deliberately left at each edge to breathe. */
      padSec: number;
    };
  };
  /** DJ interstitial (spoken time-check) settings. */
  dj: {
    /** Master on/off for DJ segments; false = songs only (Phase I behavior). */
    enabled: boolean;
    /** The DJ speaks once every N songs. */
    everyNSongs: number;
    /**
     * Talk OVER the song's fading tail (ducking) vs back-to-back after it.
     * Defaults to `false` (back-to-back) so a song's tail is never ducked
     * unless overlap is explicitly opted into.
     */
    overlap: boolean;
    /** Seconds of silence inserted between every item; 0 = seamless back-to-back. */
    gapSec: number;
    /** Seconds of music-only outro left after the DJ voice ends (overlap mode). */
    overlapTailPadSec: number;
    /**
     * Generate-ahead lead (seconds): synthesize the next DJ clip this many
     * seconds before the preceding song ends, so it's ready at the boundary and
     * no silence gap forms while TTS runs. Kept small so a time-check stays
     * accurate to the minute (a large lead would announce a stale time).
     */
    prefetchLeadSec: number;
    /**
     * Seconds to add to the announced time to compensate for pipeline + player
     * latency (generate-ahead + stream buffering), so the spoken time matches
     * what the listener's clock reads when they actually hear it.
     */
    timeOffsetSec: number;
    /** Which TTS engine to bind: 'espeak' (default) or 'piper'. */
    ttsEngine: string;
    /** Piper voice model (.onnx) path — only used when ttsEngine is 'piper'. */
    voiceModelPath: string;
    /** Directory where synthesized DJ clips are cached. */
    cacheDir: string;
  };
}

/**
 * Human-readable summary of the effective config, for logging at startup so the
 * running station's real settings (engine, timezone, cadence, …) are visible in
 * the logs — invaluable when env vars come from several places (image, blueprint,
 * dashboard).
 */
export function describeConfig(c: StreamConfig): string[] {
  return [
    `Station : ${c.station.name} ${c.station.frequency} · ${c.station.city} · TZ=${c.station.timeZone}`,
    `Audio   : ${c.bitrate} @ ${c.sampleRate}Hz · ffmpeg=${c.ffmpegPath} · media=${c.mediaDir}`,
    `Trim    : ${c.trim.enabled ? `ON (below ${c.trim.thresholdDb}dB for ${c.trim.minSilenceSec}s)` : 'OFF'}`,
    `DJ      : ${c.dj.enabled ? 'ON' : 'OFF'} · every ${c.dj.everyNSongs} song(s) · ` +
      `${c.dj.overlap ? 'overlap/duck' : 'back-to-back'} · gap ${c.dj.gapSec}s · ` +
      `prefetch-lead ${c.dj.prefetchLeadSec}s · time-offset ${c.dj.timeOffsetSec}s`,
    `TTS     : ${c.dj.ttsEngine}` +
      (c.dj.ttsEngine === 'piper' ? ` · voice=${c.dj.voiceModelPath}` : '') +
      ` · cache=${c.dj.cacheDir}`,
  ];
}

export function loadStreamConfig(): StreamConfig {
  return {
    ffmpegPath: process.env.FFMPEG_PATH ?? 'ffmpeg',
    ffprobePath: process.env.FFPROBE_PATH ?? 'ffprobe',
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
      timeZone: process.env.STATION_TIMEZONE ?? 'America/New_York',
    },
    trim: {
      enabled: (process.env.TRIM_SILENCE ?? 'true') !== 'false',
      thresholdDb: Number(process.env.TRIM_THRESHOLD_DB ?? -50),
      minSilenceSec: Math.max(
        0.05,
        Number(process.env.TRIM_MIN_SILENCE ?? 0.2),
      ),
      speech: {
        enabled: (process.env.TRIM_SPEECH ?? 'true') !== 'false',
        thresholdDb: Number(process.env.TRIM_SPEECH_THRESHOLD_DB ?? -60),
        padSec: Math.max(0, Number(process.env.TRIM_SPEECH_PAD ?? 0.12)),
      },
    },
    dj: {
      enabled: (process.env.DJ_ENABLED ?? 'true') !== 'false',
      everyNSongs: Math.max(1, Number(process.env.DJ_EVERY_N_SONGS ?? 1)),
      overlap: (process.env.DJ_OVERLAP ?? 'false') === 'true',
      gapSec: Math.max(0, Number(process.env.DJ_GAP ?? 0.5)),
      overlapTailPadSec: Math.max(0, Number(process.env.DJ_TAIL_PAD ?? 0.5)),
      prefetchLeadSec: Math.max(0, Number(process.env.DJ_PREFETCH_LEAD ?? 3)),
      timeOffsetSec: Math.max(0, Number(process.env.DJ_TIME_OFFSET_SEC ?? 10)),
      ttsEngine: process.env.DJ_TTS_ENGINE ?? 'espeak',
      voiceModelPath:
        process.env.DJ_VOICE_MODEL ?? '/app/voices/en_US-lessac-medium.onnx',
      cacheDir: process.env.DJ_CACHE_DIR ?? join(tmpdir(), 'radio-dj-clips'),
    },
  };
}
