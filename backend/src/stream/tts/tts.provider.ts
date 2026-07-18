import { Logger, type Provider } from '@nestjs/common';
import { loadStreamConfig } from '../stream.config';
import { EspeakTtsService } from './espeak-tts.service';
import { PiperTtsService } from './piper-tts.service';
import { TTS_SERVICE, type TtsService } from './tts.interface';

/**
 * Binds the active {@link TtsService} from config (`DJ_TTS_ENGINE`). Switching
 * engines is env-only — no code change. Defaults to espeak-ng.
 */
export const ttsProvider: Provider = {
  provide: TTS_SERVICE,
  useFactory: (): TtsService => {
    const { dj } = loadStreamConfig();
    const logger = new Logger('TtsFactory');
    switch (dj.ttsEngine) {
      case 'piper':
        logger.log(`TTS engine: piper (${dj.voiceModelPath})`);
        return new PiperTtsService(dj.cacheDir, dj.voiceModelPath);
      case 'espeak':
        logger.log('TTS engine: espeak-ng');
        return new EspeakTtsService(dj.cacheDir);
      default:
        logger.warn(`Unknown DJ_TTS_ENGINE "${dj.ttsEngine}"; using espeak-ng`);
        return new EspeakTtsService(dj.cacheDir);
    }
  },
};
