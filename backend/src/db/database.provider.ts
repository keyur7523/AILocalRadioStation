import { Logger } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { Segue } from './entities/segue.entity';
import { Setting } from './entities/setting.entity';
import { Song } from './entities/song.entity';

/** DI token for the database handle, which may legitimately be absent. */
export const DATA_SOURCE = Symbol('DataSource');

/**
 * The station's database handle, or `null` when there isn't one.
 *
 * Connecting is deliberately best-effort. This is a radio station: the one
 * unforgivable failure is going off air, and settings are a convenience next to
 * that. So we never use `TypeOrmModule.forRoot`, which aborts application
 * startup if the database is unreachable — a Postgres hiccup would take the
 * broadcast down with it. Instead we try to connect, and on failure log it and
 * hand out `null`; every consumer treats that as "fall back to env defaults".
 *
 * Set DATABASE_URL to enable. Without it the station behaves exactly as it did
 * before there was a database.
 */
export async function createDataSource(): Promise<DataSource | null> {
  const logger = new Logger('Database');
  const url = process.env.DATABASE_URL;
  if (!url) {
    logger.log('No DATABASE_URL — settings fall back to env defaults');
    return null;
  }

  const dataSource = new DataSource({
    type: 'postgres',
    url,
    entities: [Setting, Song, Segue],
    // A handful of additive tables; let TypeORM keep them in step rather than
    // carrying a migration runner for this much schema.
    synchronize: true,
    logging: ['error'],
    // Managed Postgres (Render included) terminates non-TLS connections.
    ssl:
      process.env.DATABASE_SSL === 'false'
        ? false
        : { rejectUnauthorized: false },
    connectTimeoutMS: 10000,
  });

  try {
    await dataSource.initialize();
    logger.log('Connected — settings, songs and segues are persistent');
    return dataSource;
  } catch (err) {
    logger.error(
      `Could not connect (${(err as Error).message}); continuing without it — ` +
        'the station still plays, but settings will not persist',
    );
    return null;
  }
}

export const databaseProvider = {
  provide: DATA_SOURCE,
  useFactory: createDataSource,
};
