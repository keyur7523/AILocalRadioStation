/**
 * Pluggable text-to-speech contract for the DJ.
 *
 * The concrete engine (espeak-ng, Piper, cloud…) is chosen by DI binding, so no
 * engine detail leaks into the sequencer/DJ code. Implementations synthesize the
 * text to an audio file and resolve with its path, and MUST cache by content so
 * an identical phrase is not re-synthesized.
 */
export interface TtsService {
  /** Synthesize `text` to an audio file; resolve with its absolute path. */
  synthesize(text: string): Promise<string>;
}

/** Nest DI token for the active {@link TtsService}. */
export const TTS_SERVICE = Symbol('TtsService');
