/**
 * The DJ voices available to the station.
 *
 * Voices are **discovered**, not hard-coded: any `.onnx` Piper model sitting in
 * the voices directory is offered. Adding a voice is therefore a Dockerfile
 * change alone — nothing here needs updating to keep a registry in sync.
 */
import { existsSync, readdirSync } from 'node:fs';
import { basename, join } from 'node:path';

export interface VoiceInfo {
  /** Stable id used to select the voice, e.g. `en_US-ryan-high`. */
  id: string;
  /** Human-readable label for the admin UI, e.g. `Ryan (high)`. */
  label: string;
  /** Absolute path to the `.onnx` model. */
  modelPath: string;
}

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
  return `${name} (${quality})`;
}

/** Every Piper voice present in `dir`, sorted by id. Empty if there are none. */
export function discoverVoices(dir: string): VoiceInfo[] {
  if (!existsSync(dir)) return [];
  try {
    return readdirSync(dir)
      .filter((f) => f.toLowerCase().endsWith('.onnx'))
      .sort()
      .map((f) => {
        const id = basename(f, '.onnx');
        return { id, label: labelForVoice(id), modelPath: join(dir, f) };
      });
  } catch {
    return [];
  }
}
