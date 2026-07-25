import { Module } from '@nestjs/common';
import { AdminController } from './admin.controller';
import { BroadcasterService } from './broadcaster.service';
import { DjService } from './dj/dj.service';
import { SequencerService } from './dj/sequencer.service';
import { StationConfigService } from './station-config.service';
import { StreamController } from './stream.controller';
import { ttsProvider } from './tts/tts.provider';

/**
 * Owns the live broadcast: the sequencer/encoder engine, the DJ + TTS, the
 * listener fan-out, the runtime station identity, and the HTTP surface
 * (`/stream`, `/station`, `/health`, `/admin/config`).
 */
@Module({
  controllers: [StreamController, AdminController],
  providers: [
    StationConfigService,
    BroadcasterService,
    SequencerService,
    DjService,
    ttsProvider,
  ],
})
export class StreamModule {}
