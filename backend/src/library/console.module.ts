import { Module } from '@nestjs/common';
import { StreamModule } from '../stream/stream.module';
import { ImportService } from './import.service';
import { LibraryController } from './library.controller';

/**
 * The admin console's HTTP surface. Imports StreamModule for the voice box, so
 * lines can be auditioned in whatever voice is currently on air; the library
 * services reach it globally.
 */
@Module({
  imports: [StreamModule],
  controllers: [LibraryController],
  providers: [ImportService],
})
export class ConsoleModule {}
