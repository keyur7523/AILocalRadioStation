import { Logger, type Provider } from '@nestjs/common';
import { loadStreamConfig } from '../stream.config';
import { EspeakTtsService } from './espeak-tts.service';
import { PiperTtsService } from './piper-tts.service';
import { RoutingTtsService } from './routing-tts.service';
import { TTS_SERVICE, type TtsService } from './tts.interface';
import { VoiceConfigService } from './voice-config.service';

/**
 * Build the DJ's voice box: both engines, routed per call by whichever voice is
 * on air (see {@link RoutingTtsService}).
 *
 * Exported as a plain factory as well as a Nest provider so build-time tooling
 * can construct the *same* engines as the running app — the clip cache is keyed
 * on engine and voice, so anything pre-generated differently would simply miss.
 */
export function createTtsService(voices?: VoiceConfigService): TtsService {
  const { dj } = loadStreamConfig();
  const registry = voices ?? new VoiceConfigService();
  const logger = new Logger('TtsFactory');
  logger.log(
    `TTS ready — on air: ${registry.current.id} (${registry.current.engine})`,
  );
  return new RoutingTtsService(registry, {
    espeak: new EspeakTtsService(dj.cacheDir),
    // Resolved per call so a live voice switch takes effect immediately.
    piper: new PiperTtsService(dj.cacheDir, () => registry.modelPath),
  });
}

export const ttsProvider: Provider = {
  provide: TTS_SERVICE,
  useFactory: (voices: VoiceConfigService) => createTtsService(voices),
  inject: [VoiceConfigService],
};
