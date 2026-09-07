import { Module } from '@nestjs/common';
import { DatabaseModule } from './db/database.module';
import { MediaModule } from './media/media.module';
import { ConsoleModule } from './library/console.module';
import { LibraryModule } from './library/library.module';
import { StreamModule } from './stream/stream.module';

@Module({
  imports: [
    DatabaseModule,
    MediaModule,
    LibraryModule,
    StreamModule,
    ConsoleModule,
  ],
})
export class AppModule {}
