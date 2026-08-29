import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { DatabaseGateway } from '../db/database.gateway';
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

  constructor(private readonly db: DatabaseGateway) {}

  get available(): boolean {
    return this.db.available;
  }

  async onModuleInit(): Promise<void> {
    await this.db.run(async (ds) => {
      const repo = ds.getRepository(Segue);
      if ((await repo.count()) > 0) return false;
      await repo.save(repo.create(SeguesService.SEED));
      this.logger.log(
        `Seeded ${SeguesService.SEED.length} segues from the DJ's existing lines`,
      );
      return true;
    });
  }

  /** Every segue, grouped sensibly for the admin: before first, then after. */
  async list(): Promise<Segue[]> {
    return (
      (await this.db.run((ds) =>
        ds
          .getRepository(Segue)
          .find({ order: { placement: 'ASC', position: 'ASC' } }),
      )) ?? []
    );
  }

  /** The enabled lines for one placement — what the DJ actually draws from. */
  async enabledFor(placement: SeguePlacement): Promise<Segue[]> {
    return (
      (await this.db.run((ds) =>
        ds.getRepository(Segue).find({
          where: { placement, enabled: true },
          order: { position: 'ASC' },
        }),
      )) ?? []
    );
  }

  async create(input: Partial<Segue>): Promise<Segue> {
    const text = (input.text ?? '').trim();
    if (!text) throw new Error('Segue text cannot be empty');
    const placement = this.assertPlacement(input.placement);
    const saved = await this.db.run(async (ds) => {
      const repo = ds.getRepository(Segue);
      const count = await repo.count({ where: { placement } });
      return repo.save(
        repo.create({
          text,
          placement,
          enabled: input.enabled ?? true,
          position: count,
        }),
      );
    });
    if (!saved) throw new Error('Could not save — segues are unavailable');
    return saved;
  }

  async update(id: string, patch: Partial<Segue>): Promise<Segue> {
    const saved = await this.db.run(async (ds) => {
      const repo = ds.getRepository(Segue);
      const segue = await repo.findOne({ where: { id } });
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
      return repo.save(segue);
    });
    if (!saved) throw new Error('Could not save — segues are unavailable');
    return saved;
  }

  async remove(id: string): Promise<void> {
    const done = await this.db.run((ds) =>
      ds.getRepository(Segue).delete({ id }),
    );
    if (!done) throw new Error('Could not delete — segues are unavailable');
  }

  private assertPlacement(value: unknown): SeguePlacement {
    if (value !== 'before' && value !== 'after') {
      throw new Error('placement must be "before" or "after"');
    }
    return value;
  }
}
