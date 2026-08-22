/**
 * The DJ voices available to the station.
 *
 * A "voice" spans engines: the robotic espeak-ng voice and every neural Piper
 * model sit in one list, so the admin picks a *sound* without caring which
 * synthesizer produces it. Piper voices are **discovered** rather than
 * hard-coded — dropping another `.onnx` into the voices directory offers it
 * automatically, with no registry to keep in sync.
 */
import { existsSync, readdirSync } from 'node:fs';
import { basename, join } from 'node:path';

export type VoiceEngine = 'espeak' | 'piper';

export interface VoiceInfo {
  /** Stable id used to select the voice, e.g. `espeak` or `en_US-ryan-high`. */
  id: string;
  /** Human-readable label for the admin UI. */
  label: string;
  /** Which synthesizer renders it. */
  engine: VoiceEngine;
  /** Absolute path to the `.onnx` model (Piper voices only). */
  modelPath?: string;
}

/**
 * The robotic voice. Always available: espeak-ng is tiny, ships in the image,
 * and synthesizes in milliseconds, so it is the dependable fallback on a host
 * that cannot spare CPU for a neural model.
 */
export const ESPEAK_VOICE: VoiceInfo = {
  id: 'espeak',
  label: 'Robotic (espeak-ng)',
  engine: 'espeak',
};

/**
 * Turn `en_US-ryan-high` into `Ryan (high)` — Piper names voices
 * `<locale>-<speaker>-<quality>`.
 */
export function labelForVoice(id: string): string {
  const parts = id.split('-');
  if (parts.length < 3) return id;
  const [, speaker, quality] = parts;
  const name = speaker
    .split('_')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
  return `${name} (${quality}, natural)`;
}

/** Piper voices installed in `dir`, sorted by id. Empty if there are none. */
export function discoverPiperVoices(dir: string): VoiceInfo[] {
  if (!existsSync(dir)) return [];
  try {
    return readdirSync(dir)
      .filter((f) => f.toLowerCase().endsWith('.onnx'))
      .sort()
      .map((f) => {
        const id = basename(f, '.onnx');
        return {
          id,
          label: labelForVoice(id),
          engine: 'piper' as const,
          modelPath: join(dir, f),
        };
      });
  } catch {
    return [];
  }
}

/** Every selectable voice: the robotic one, then any neural voices installed. */
export function discoverVoices(dir: string): VoiceInfo[] {
  return [ESPEAK_VOICE, ...discoverPiperVoices(dir)];
}
