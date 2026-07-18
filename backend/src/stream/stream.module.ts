import { Module } from '@nestjs/common';
import { BroadcasterService } from './broadcaster.service';
import { DjService } from './dj/dj.service';
import { SequencerService } from './dj/sequencer.service';
import { StreamController } from './stream.controller';
import { ttsProvider } from './tts/tts.provider';

/**
 * Owns the live broadcast: the sequencer/encoder engine, the DJ + TTS, the
 * listener fan-out, and the HTTP surface (`/stream`, `/station`, `/health`).
 */
@Module({
  controllers: [StreamController],
  providers: [
    BroadcasterService,
    SequencerService,
    DjService,
    ttsProvider,
  ],
})
export class StreamModule {}
