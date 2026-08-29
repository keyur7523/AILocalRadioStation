import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';

/** Where a segue sits relative to the song it refers to. */
export type SeguePlacement = 'before' | 'after';

/**
 * A line the DJ can say around a song, written as a template.
 *
 * Placeholders are filled at broadcast time:
 *   [TIME]         the current time, e.g. "3:42 PM"
 *   [SONG NAME]    the song's title (its phonetic spelling if one is set)
 *   [ARTIST NAME]  the artist (likewise)
 *
 * `before` lines introduce the song coming up; `after` lines back-announce the
 * one that just finished. Several can be active — the DJ rotates through them so
 * consecutive breaks don't repeat.
 */
@Entity('segues')
export class Segue {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'text' })
  text!: string;

  @Column({ type: 'text' })
  placement!: SeguePlacement;

  /** Unticked lines stay in the list but are never spoken. */
  @Column({ type: 'boolean', default: true })
  enabled!: boolean;

  @Column({ type: 'int', default: 0 })
  position!: number;
}
