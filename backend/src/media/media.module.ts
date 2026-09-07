import { Global, Module } from '@nestjs/common';
import { MediaStoreService } from './media-store.service';

/**
 * Where the music comes from. Global because both the library (which catalogues
 * tracks) and the broadcast engine (which plays them) need it, and it holds a
 * single download cache that must not be duplicated.
 */
@Global()
@Module({
  providers: [MediaStoreService],
  exports: [MediaStoreService],
})
export class MediaModule {}
