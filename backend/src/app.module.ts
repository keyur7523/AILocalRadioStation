import { Module } from '@nestjs/common';
import { DatabaseModule } from './db/database.module';
import { LibraryModule } from './library/library.module';
import { StreamModule } from './stream/stream.module';

@Module({
  imports: [DatabaseModule, StreamModule, LibraryModule],
})
export class AppModule {}
