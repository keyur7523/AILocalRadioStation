import { Inject, Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import type { DataSource, Repository } from 'typeorm';
import { DATA_SOURCE } from '../db/database.provider';
import { Segue, type SeguePlacement } from '../db/entities/segue.entity';

/**
 * The lines the DJ can say around a song.
 *
 * On first run the table is seeded with the station's existing patter, so
 * turning the database on changes nothing audible — the DJ carries on saying
 * what it always said, except the lines are now editable.
 */
@Injectable()
export class SeguesService implements OnModuleInit {
  private readonly logger = new Logger(SeguesService.name);
  private readonly repo: Repository<Segue> | null;

  /** What the DJ said before segues were editable. */
  private static readonly SEED: Omit<Segue, 'id'>[] = [
    {
      text: "That was [SONG NAME] by [ARTIST NAME]. Right now it's [TIME], and we've got plenty more music coming your way.",
      placement: 'after',
      enabled: true,
      position: 0,
    },
    {
      text: "You just heard [SONG NAME] from [ARTIST NAME]. It's [TIME]. Stay right here for more music.",
      placement: 'after',
      enabled: true,
      position: 1,
    },
    {
      text: 'Next up, [SONG NAME] by [ARTIST NAME].',
      placement: 'before',
      enabled: true,
      position: 0,
    },
    {
      text: "Now let's listen to [SONG NAME] by [ARTIST NAME].",
      placement: 'before',
      enabled: true,
      position: 1,
    },
  ];

  constructor(@Inject(DATA_SOURCE) dataSource: DataSource | null) {
    this.repo = dataSource ? dataSource.getRepository(Segue) : null;
  }

  get available(): boolean {
    return this.repo !== null;
  }

  async onModuleInit(): Promise<void> {
    if (!this.repo) return;
    try {
      if ((await this.repo.count()) === 0) {
        await this.repo.save(this.repo.create(SeguesService.SEED));
        this.logger.log(
          `Seeded ${SeguesService.SEED.length} segues from the DJ's existing lines`,
        );
      }
    } catch (err) {
      this.logger.warn(`segue seeding failed: ${(err as Error).message}`);
    }
  }

  /** Every segue, grouped sensibly for the admin: before first, then after. */
  async list(): Promise<Segue[]> {
    if (!this.repo) return [];
    return this.repo.find({ order: { placement: 'ASC', position: 'ASC' } });
  }

  /** The enabled lines for one placement — what the DJ actually draws from. */
  async enabledFor(placement: SeguePlacement): Promise<Segue[]> {
    if (!this.repo) return [];
    return this.repo.find({
      where: { placement, enabled: true },
      order: { position: 'ASC' },
    });
  }

  async create(input: Partial<Segue>): Promise<Segue> {
    if (!this.repo) throw new Error('No database — segues are read-only');
    const text = (input.text ?? '').trim();
    if (!text) throw new Error('Segue text cannot be empty');
    const placement = this.assertPlacement(input.placement);
    const count = await this.repo.count({ where: { placement } });
    return this.repo.save(
      this.repo.create({
        text,
        placement,
        enabled: input.enabled ?? true,
        position: count,
      }),
    );
  }

  async update(id: string, patch: Partial<Segue>): Promise<Segue> {
    if (!this.repo) throw new Error('No database — segues are read-only');
    const segue = await this.repo.findOne({ where: { id } });
    if (!segue) throw new Error(`No segue with id "${id}"`);
    if (patch.text !== undefined) {
      const text = patch.text.trim();
      if (!text) throw new Error('Segue text cannot be empty');
      segue.text = text;
    }
    if (patch.placement !== undefined) {
      segue.placement = this.assertPlacement(patch.placement);
    }
    if (typeof patch.enabled === 'boolean') segue.enabled = patch.enabled;
    if (typeof patch.position === 'number') segue.position = patch.position;
    return this.repo.save(segue);
  }

  async remove(id: string): Promise<void> {
    if (!this.repo) throw new Error('No database — segues are read-only');
    await this.repo.delete({ id });
  }

  private assertPlacement(value: unknown): SeguePlacement {
    if (value !== 'before' && value !== 'after') {
      throw new Error('placement must be "before" or "after"');
    }
    return value;
  }
}
