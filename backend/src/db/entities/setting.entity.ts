import { Column, Entity, PrimaryColumn, UpdateDateColumn } from 'typeorm';

/**
 * Free-form station settings, one row per key (`station`, `voice`, …).
 *
 * Key/value rather than a column per setting: these are read and written as
 * whole objects by the admin panel, and a new setting should not need a schema
 * change to store.
 */
@Entity('settings')
export class Setting {
  @PrimaryColumn({ type: 'text' })
  key!: string;

  @Column({ type: 'jsonb' })
  value!: Record<string, unknown>;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt!: Date;
}
