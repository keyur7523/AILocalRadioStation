import { Module } from '@nestjs/common';
import { StreamModule } from '../stream/stream.module';
import { LibraryController } from './library.controller';
import { SeguesService } from './segues.service';
import { SongsService } from './songs.service';

/**
 * The station's library: the running order and the DJ's patter, plus the console
 * that edits them. Imports StreamModule for the TTS voice box, which the preview
 * endpoint uses to audition lines in whatever voice is currently on air.
 */
@Module({
  imports: [StreamModule],
  controllers: [LibraryController],
  providers: [SongsService, SeguesService],
  exports: [SongsService, SeguesService],
})
export class LibraryModule {}
