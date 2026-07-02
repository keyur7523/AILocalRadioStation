import { Module } from '@nestjs/common';
import { BroadcasterService } from './broadcaster.service';
import { StreamController } from './stream.controller';

/**
 * Owns the live broadcast: the ffmpeg engine, the listener fan-out, and the
 * HTTP surface (`/stream`, `/station`, `/health`).
 */
@Module({
  controllers: [StreamController],
  providers: [BroadcasterService],
})
export class StreamModule {}
