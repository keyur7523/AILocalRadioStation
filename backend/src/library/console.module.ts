import { Module } from '@nestjs/common';
import { StreamModule } from '../stream/stream.module';
import { LibraryController } from './library.controller';

/**
 * The admin console's HTTP surface. Imports StreamModule for the voice box, so
 * lines can be auditioned in whatever voice is currently on air; the library
 * services reach it globally.
 */
@Module({
  imports: [StreamModule],
  controllers: [LibraryController],
})
export class ConsoleModule {}
