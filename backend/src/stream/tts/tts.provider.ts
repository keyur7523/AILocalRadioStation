import { Logger, type Provider } from '@nestjs/common';
import { loadStreamConfig } from '../stream.config';
import { EspeakTtsService } from './espeak-tts.service';
import { PiperTtsService } from './piper-tts.service';
import { TTS_SERVICE, type TtsService } from './tts.interface';
import { VoiceConfigService } from './voice-config.service';

/**
 * Build the active {@link TtsService} from config (`DJ_TTS_ENGINE`). Switching
 * engines is env-only — no code change. Defaults to espeak-ng.
 *
 * Exported as a plain factory (not just a Nest provider) so build-time tooling
 * can construct the *same* engine and voice as the running app — the clip cache
 * is keyed on both, so anything pre-generated with a different one would miss.
 */
export function createTtsService(voices?: VoiceConfigService): TtsService {
  const { dj } = loadStreamConfig();
  const logger = new Logger('TtsFactory');
  switch (dj.ttsEngine) {
    case 'piper': {
      // Resolve the model per call so the admin can switch voices live.
      const registry = voices ?? new VoiceConfigService();
      logger.log(`TTS engine: piper (${registry.current?.id ?? 'default'})`);
      return new PiperTtsService(dj.cacheDir, () => registry.modelPath);
    }
    case 'espeak':
      logger.log('TTS engine: espeak-ng');
      return new EspeakTtsService(dj.cacheDir);
    default:
      logger.warn(`Unknown DJ_TTS_ENGINE "${dj.ttsEngine}"; using espeak-ng`);
      return new EspeakTtsService(dj.cacheDir);
  }
}

export const ttsProvider: Provider = {
  provide: TTS_SERVICE,
  useFactory: (voices: VoiceConfigService) => createTtsService(voices),
  inject: [VoiceConfigService],
};
