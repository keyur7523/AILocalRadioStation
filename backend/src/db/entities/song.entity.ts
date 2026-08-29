import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
} from 'typeorm';

/**
 * One track in the rotation.
 *
 * The audio itself stays on disk (shipped in the image); this row is the
 * station's view of it — what the DJ calls it, where it sits in the running
 * order, and whether it plays at all.
 */
@Entity('songs')
export class Song {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  /** Filename within the media directory, e.g. `01-daydream.mp3`. */
  @Column({ type: 'text', unique: true })
  file!: string;

  @Column({ type: 'text' })
  title!: string;

  @Column({ type: 'text', nullable: true })
  artist!: string | null;

  /**
   * How to *say* the title, when the spelling misleads the synthesizer
   * ("7AM" → "seven A M"). Falls back to `title` when empty.
   */
  @Column({ type: 'text', nullable: true })
  phoneticTitle!: string | null;

  /** Same idea for the artist — names are what TTS most often mangles. */
  @Column({ type: 'text', nullable: true })
  phoneticArtist!: string | null;

  /** Running order. Lower plays first. */
  @Column({ type: 'int', default: 0 })
  position!: number;

  /**
   * Kept in the library but never played. Deliberately not a delete, so a track
   * can be rested and brought back without re-importing it.
   */
  @Column({ type: 'boolean', default: false })
  skip!: boolean;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;
}
