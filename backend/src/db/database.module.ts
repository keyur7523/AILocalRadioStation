import { Global, Module, type OnApplicationShutdown } from '@nestjs/common';
import { Inject } from '@nestjs/common';
import type { DataSource } from 'typeorm';
import { DATA_SOURCE, databaseProvider } from './database.provider';
import { DatabaseGateway } from './database.gateway';
import { SettingsService } from './settings.service';

/**
 * Database wiring, available application-wide.
 *
 * Global because the handle is a single shared resource and several unrelated
 * services need it. Exports the raw {@link DataSource} (possibly `null`) so
 * feature services can build their own repositories, plus {@link SettingsService}
 * for the simple key/value cases.
 */
@Global()
@Module({
  providers: [databaseProvider, DatabaseGateway, SettingsService],
  exports: [DATA_SOURCE, DatabaseGateway, SettingsService],
})
export class DatabaseModule implements OnApplicationShutdown {
  constructor(@Inject(DATA_SOURCE) private readonly ds: DataSource | null) {}

  async onApplicationShutdown(): Promise<void> {
    if (this.ds?.isInitialized) await this.ds.destroy();
  }
}
