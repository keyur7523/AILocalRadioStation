import { Inject, Injectable, Logger } from '@nestjs/common';
import type { DataSource, Repository } from 'typeorm';
import { DATA_SOURCE } from './database.provider';
import { Setting } from './entities/setting.entity';

/**
 * Reads and writes the station's settings.
 *
 * Every method tolerates there being no database: reads return `null` and
 * writes quietly do nothing, so callers keep whatever they seeded from env.
 * That is what lets the broadcast survive a Postgres outage untouched.
 */
@Injectable()
export class SettingsService {
  private readonly logger = new Logger(SettingsService.name);
  private readonly repo: Repository<Setting> | null;

  constructor(@Inject(DATA_SOURCE) dataSource: DataSource | null) {
    this.repo = dataSource ? dataSource.getRepository(Setting) : null;
  }

  /** Whether settings will actually persist. */
  get available(): boolean {
    return this.repo !== null;
  }

  /** The stored value for `key`, or `null` if absent or unavailable. */
  async get<T extends object>(key: string): Promise<T | null> {
    if (!this.repo) return null;
    try {
      const row = await this.repo.findOne({ where: { key } });
      return (row?.value as T) ?? null;
    } catch (err) {
      this.logger.warn(`read "${key}" failed: ${(err as Error).message}`);
      return null;
    }
  }

  /** Store `value` under `key`. Never throws — a failed write only warns. */
  async set(key: string, value: Record<string, unknown>): Promise<void> {
    if (!this.repo) return;
    try {
      // save() rather than upsert(): the row is tiny and this keeps the typing
      // straightforward for a jsonb column.
      await this.repo.save(this.repo.create({ key, value }));
    } catch (err) {
      this.logger.warn(`write "${key}" failed: ${(err as Error).message}`);
    }
  }
}
