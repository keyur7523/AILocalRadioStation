import { Module } from '@nestjs/common';
import { DatabaseModule } from './db/database.module';
import { StreamModule } from './stream/stream.module';

@Module({
  imports: [DatabaseModule, StreamModule],
})
export class AppModule {}
