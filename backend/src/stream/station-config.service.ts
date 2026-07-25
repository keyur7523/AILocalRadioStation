import { Injectable, Logger } from '@nestjs/common';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { loadStreamConfig } from './stream.config';
import {
  US_STATION_PRESETS,
  type StationIdentity,
  type StationPreset,
} from './station-presets';

/**
 * The single source of truth for the station's **on-air identity** (name,
 * frequency, tagline, city, timezone) at runtime. Seeded from env, editable live
 * via the admin API, and persisted to a small JSON file so a selection survives
 * process restarts. Other services read identity/timezone from here so an admin
 * change takes effect without restarting the audio engine.
 */
@Injectable()
export class StationConfigService {
  private readonly logger = new Logger(StationConfigService.name);
  private readonly stateFile =
    process.env.STATION_STATE_FILE ?? join(tmpdir(), 'radio-station.json');
  private identity: StationIdentity;

  constructor() {
    const fromEnv = loadStreamConfig().station;
    this.identity = this.loadPersisted() ?? { ...fromEnv };
    this.logger.log(
      `Station identity: ${this.identity.name} · ${this.identity.city} · ${this.identity.timeZone}`,
    );
  }

  /** Current on-air identity (a copy — callers can't mutate internal state). */
  get(): StationIdentity {
    return { ...this.identity };
  }

  /** The timezone the DJ announces the time in (read fresh, so live-editable). */
  get timeZone(): string {
    return this.identity.timeZone;
  }

  /** The selectable US-timezone presets. */
  get presets(): StationPreset[] {
    return US_STATION_PRESETS;
  }

  /** Apply a preset by id. Throws if the id is unknown. */
  applyPreset(id: string): StationIdentity {
    const preset = US_STATION_PRESETS.find((p) => p.id === id);
    if (!preset) {
      throw new Error(`Unknown preset "${id}"`);
    }
    return this.update({
      name: preset.name,
      frequency: preset.frequency,
      tagline: preset.tagline,
      city: preset.city,
      timeZone: preset.timeZone,
    });
  }

  /**
   * Merge a partial identity in. Validates the timezone (if given) and non-empty
   * strings, persists, and logs. Returns the new identity.
   */
  update(patch: Partial<StationIdentity>): StationIdentity {
    const next: StationIdentity = { ...this.identity };
    for (const key of [
      'name',
      'frequency',
      'tagline',
      'city',
      'timeZone',
    ] as const) {
      const value = patch[key];
      if (value === undefined) continue;
      if (typeof value !== 'string' || value.trim() === '') {
        throw new Error(`"${key}" must be a non-empty string`);
      }
      next[key] = value.trim();
    }
    if (patch.timeZone !== undefined) this.assertValidTimeZone(next.timeZone);

    this.identity = next;
    this.persist();
    this.logger.log(
      `Station updated → ${next.name} · ${next.city} · ${next.timeZone}`,
    );
    return this.get();
  }

  /** Reject anything `Intl` can't resolve, so we never store a broken zone. */
  private assertValidTimeZone(timeZone: string): void {
    try {
      new Intl.DateTimeFormat('en-US', { timeZone });
    } catch {
      throw new Error(`Invalid IANA timezone "${timeZone}"`);
    }
  }

  private loadPersisted(): StationIdentity | null {
    try {
      if (!existsSync(this.stateFile)) return null;
      const raw = JSON.parse(readFileSync(this.stateFile, 'utf8')) as Partial<
        Record<keyof StationIdentity, unknown>
      >;
      const keys: (keyof StationIdentity)[] = [
        'name',
        'frequency',
        'tagline',
        'city',
        'timeZone',
      ];
      if (!keys.every((k) => typeof raw[k] === 'string')) return null;
      const identity = Object.fromEntries(
        keys.map((k) => [k, raw[k]]),
      ) as unknown as StationIdentity;
      this.logger.log(`Restored station identity from ${this.stateFile}`);
      return identity;
    } catch (err) {
      this.logger.warn(
        `Could not read persisted station config: ${(err as Error).message}`,
      );
      return null;
    }
  }

  private persist(): void {
    try {
      mkdirSync(dirname(this.stateFile), { recursive: true });
      writeFileSync(this.stateFile, JSON.stringify(this.identity, null, 2));
    } catch (err) {
      this.logger.warn(
        `Could not persist station config: ${(err as Error).message}`,
      );
    }
  }
}
