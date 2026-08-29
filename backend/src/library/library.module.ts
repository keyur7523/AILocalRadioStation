import { Global, Module } from '@nestjs/common';
import { SeguesService } from './segues.service';
import { SongsService } from './songs.service';

/**
 * What the station plays and says, as data.
 *
 * Global and deliberately import-free: the broadcast engine reads the running
 * order and the DJ's lines from here, while the console (a separate module)
 * edits them through the stream's voice box. Were this module to import
 * StreamModule for that, the two would depend on each other and Nest could not
 * decide which to build first.
 */
@Global()
@Module({
  providers: [SongsService, SeguesService],
  exports: [SongsService, SeguesService],
})
export class LibraryModule {}
