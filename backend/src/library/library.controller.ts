import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Header,
  Inject,
  Logger,
  Param,
  Patch,
  Post,
  Query,
  Res,
} from '@nestjs/common';
import type { Response } from 'express';
import { createReadStream } from 'node:fs';
import { Segue } from '../db/entities/segue.entity';
import { Song } from '../db/entities/song.entity';
import { SequencerService } from '../stream/dj/sequencer.service';
import { TTS_SERVICE, type TtsService } from '../stream/tts/tts.interface';
import { LIBRARY_HTML } from './library.page';
import { PLACEHOLDERS, renderSegue } from './segue-template';
import { SeguesService } from './segues.service';
import { SongsService } from './songs.service';

/**
 * The station's library console: the running order, how the DJ pronounces each
 * track, and the lines it says around them.
 *
 * Unauthenticated, like the rest of `/admin` — see the note on AdminController.
 */
@Controller('admin')
export class LibraryController {
  private readonly logger = new Logger(LibraryController.name);

  constructor(
    private readonly songs: SongsService,
    private readonly segues: SeguesService,
    @Inject(TTS_SERVICE) private readonly tts: TtsService,
    private readonly sequencer: SequencerService,
  ) {}

  /** The running order, plus whether edits are possible at all. */
  /**
   * What the engine is playing versus what the library says it should.
   *
   * These drift by design: the running order is fixed when the broadcast starts,
   * so skipping or reordering a track changes the console immediately and the
   * air only at the next rescan. Without this, that gap is invisible and looks
   * like the wrong song playing.
   */
  @Get('onair')
  async onAir() {
    const engine = this.sequencer.onAir;
    const expected = (await this.songs.playable()).map((s) => s.file);
    return {
      ...engine,
      expected,
      inSync:
        expected.length === engine.playlist.length &&
        expected.every((f, i) => f === engine.playlist[i]),
    };
  }

  /** The library page — song management lives here rather than on the console. */
  @Get('library')
  @Header('Content-Type', 'text/html; charset=utf-8')
  libraryPage(): string {
    return LIBRARY_HTML;
  }

  /** The running order. `?q=` filters by title, artist, spoken spelling or file. */
  @Get('songs')
  async listSongs(@Query('q') q?: string) {
    return {
      songs: q ? await this.songs.search(q) : await this.songs.list(),
      editable: this.songs.available,
    };
  }

  /**
   * Re-read the music source and pick up the result on air.
   *
   * Two steps, because they answer different questions: the reconcile catalogues
   * anything newly uploaded, and the playlist refresh makes the running order
   * take effect without waiting for a restart. The refresh is allowed to fail
   * on its own — cataloguing still succeeded, and the tracks will play after the
   * next restart regardless.
   */
  @Post('songs/rescan')
  async rescan() {
    await this.guard(() => this.songs.reconcile());
    const songs = await this.songs.list();
    let onAir: number | null = null;
    let refreshError: string | null = null;
    try {
      onAir = await this.sequencer.refreshPlaylist();
    } catch (err) {
      refreshError = (err as Error).message;
    }
    return { songs, onAir, refreshError };
  }

  /** Edit one song: titles, phonetic spellings, or rest it with `skip`. */
  @Patch('songs/:id')
  async updateSong(@Param('id') id: string, @Body() body: Partial<Song>) {
    return this.guard(() => this.songs.update(id, body));
  }

  @Delete('songs/:id')
  async deleteSong(@Param('id') id: string) {
    await this.guard(() => this.songs.remove(id));
    return { ok: true };
  }

  /** Set the running order from a list of ids, first to last. */
  @Post('songs/reorder')
  async reorder(@Body() body: { ids?: unknown }) {
    if (
      !Array.isArray(body?.ids) ||
      body.ids.some((i) => typeof i !== 'string')
    ) {
      throw new BadRequestException('Body must be { ids: string[] }');
    }
    return this.guard(() => this.songs.reorder(body.ids as string[]));
  }

  @Get('segues')
  async listSegues() {
    return {
      segues: await this.segues.list(),
      placeholders: PLACEHOLDERS,
      editable: this.segues.available,
    };
  }

  @Post('segues')
  async createSegue(@Body() body: Partial<Segue>) {
    return this.guard(() => this.segues.create(body));
  }

  @Patch('segues/:id')
  async updateSegue(@Param('id') id: string, @Body() body: Partial<Segue>) {
    return this.guard(() => this.segues.update(id, body));
  }

  @Delete('segues/:id')
  async deleteSegue(@Param('id') id: string) {
    await this.guard(() => this.segues.remove(id));
    return { ok: true };
  }

  /**
   * Speak something in the current DJ voice and stream the audio back — this is
   * what the console's play buttons use to audition a name or a segue.
   *
   * Placeholders are filled with sample values so a template can be heard as the
   * listener would hear it. Synthesis is cached and niced like any other clip,
   * so auditioning cannot disturb the broadcast.
   */
  @Post('preview')
  @Header('Cache-Control', 'no-store')
  async preview(
    @Body() body: { text?: string; songName?: string; artistName?: string },
    @Res() res: Response,
  ): Promise<void> {
    const raw = (body?.text ?? '').trim();
    if (!raw) throw new BadRequestException('Provide "text" to speak');
    if (raw.length > 500) {
      throw new BadRequestException('Text is too long to preview (max 500)');
    }
    const text = renderSegue(raw, {
      songName: body.songName ?? 'Daydream',
      artistName: body.artistName ?? 'RINZO',
      time: sampleClock(),
    });

    let clip: string;
    try {
      clip = await this.tts.synthesize(text);
    } catch (err) {
      throw new BadRequestException(
        `Could not synthesize: ${(err as Error).message}`,
      );
    }
    res.setHeader('Content-Type', 'audio/wav');
    res.setHeader('X-Spoken-Text', encodeURIComponent(text));
    // A stream 'error' with no listener is thrown, and an uncaught exception
    // exits the process — so without this, a clip that vanished before it was
    // read would have taken the whole broadcast down from an admin button.
    const audio = createReadStream(clip);
    audio.on('error', (err) => {
      this.logger.warn(`preview clip unreadable: ${err.message}`);
      if (!res.headersSent) {
        // Kept generic: the underlying message carries a server path, and this
        // endpoint is not authenticated.
        res
          .status(500)
          .json({ message: 'Could not read the synthesized clip' });
      } else {
        res.destroy(err);
      }
    });
    audio.pipe(res);
  }

  /** Surface service errors as 400s rather than 500s — they're user input. */
  private async guard<T>(run: () => Promise<T>): Promise<T> {
    try {
      return await run();
    } catch (err) {
      throw new BadRequestException((err as Error).message);
    }
  }
}

/** A plausible time for previews, so [TIME] sounds real without being live. */
function sampleClock(): string {
  return new Date()
    .toLocaleTimeString('en-US', {
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    })
    .replace(/\s+/g, ' ');
}
