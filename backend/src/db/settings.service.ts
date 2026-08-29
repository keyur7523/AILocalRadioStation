import { Injectable } from '@nestjs/common';
import { DatabaseGateway } from './database.gateway';
import { Setting } from './entities/setting.entity';

/**
 * Reads and writes the station's settings.
 *
 * Every call tolerates there being no database: reads return `null` and writes
 * quietly do nothing, so callers keep whatever they seeded from env. Going
 * through {@link DatabaseGateway} also means a connection dropped by an idle
 * serverless database is re-established rather than losing the write.
 */
@Injectable()
export class SettingsService {
  constructor(private readonly db: DatabaseGateway) {}

  /** Whether settings will actually persist. */
  get available(): boolean {
    return this.db.available;
  }

  /** The stored value for `key`, or `null` if absent or unavailable. */
  async get<T extends object>(key: string): Promise<T | null> {
    const row = await this.db.run((ds) =>
      ds.getRepository(Setting).findOne({ where: { key } }),
    );
    return (row?.value as T) ?? null;
  }

  /** Store `value` under `key`. Never throws. */
  async set(key: string, value: Record<string, unknown>): Promise<void> {
    await this.db.run(async (ds) => {
      const repo = ds.getRepository(Setting);
      return repo.save(repo.create({ key, value }));
    });
  }
}
