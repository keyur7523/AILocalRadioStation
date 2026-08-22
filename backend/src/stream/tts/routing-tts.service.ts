import type { TtsService } from './tts.interface';
import type { VoiceConfigService } from './voice-config.service';

/**
 * Sends each phrase to whichever engine the on-air voice belongs to.
 *
 * The two engines have very different costs — espeak-ng renders in milliseconds,
 * a neural Piper voice can take longer than the clip itself on a small host — so
 * the choice is worth exposing rather than fixing at boot. Both engines are held
 * ready and picked per call, which is what lets the admin switch voices live.
 *
 * Clips can't collide: the cache key already includes the engine and voice, so
 * each keeps its own and switching back is instant.
 */
export class RoutingTtsService implements TtsService {
  constructor(
    private readonly voices: VoiceConfigService,
    private readonly engines: Record<'espeak' | 'piper', TtsService>,
  ) {}

  synthesize(text: string): Promise<string> {
    return this.engines[this.voices.current.engine].synthesize(text);
  }
}
