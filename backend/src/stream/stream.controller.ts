import { Controller, Get, Res } from '@nestjs/common';
import type { Response } from 'express';
import { BroadcasterService } from './broadcaster.service';

@Controller()
export class StreamController {
  constructor(private readonly broadcaster: BroadcasterService) {}

  /**
   * The live audio feed. Holds the connection open and streams MP3 frames as
   * they come off the shared broadcast. This is the URL the `<audio>` player
   * (and the shareable link) points at.
   */
  @Get('stream')
  stream(@Res() res: Response): void {
    const { name, frequency } = this.broadcaster.getStationInfo();

    res.writeHead(200, {
      'Content-Type': 'audio/mpeg',
      'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0',
      Pragma: 'no-cache',
      Connection: 'keep-alive',
      // ICY metadata: lets media players label the station nicely.
      'icy-name': headerSafe(`${name} ${frequency}`),
    });

    this.broadcaster.addListener(res);

    const cleanup = () => this.broadcaster.removeListener(res);
    res.on('close', cleanup);
    res.on('error', cleanup);
  }

  /** Station identity and live status, consumed by the player UI. */
  @Get('station')
  station() {
    return this.broadcaster.getStationInfo();
  }

  /** Lightweight liveness probe. */
  @Get('health')
  health() {
    return { status: 'ok' };
  }
}

/**
 * Make free text safe to send as an HTTP header value.
 *
 * The station name is typed into the admin panel and ends up in the `icy-name`
 * header of every stream response. Node refuses to send a header containing a
 * control character or anything outside Latin-1 — an emoji is enough — and it
 * refuses by throwing, so one decorative character in the name was enough to
 * stop every listener from tuning in. Accents (é, ã) are Latin-1 and survive;
 * anything else is dropped rather than risk the stream.
 */
function headerSafe(value: string): string {
  const cleaned = Array.from(value)
    .map((ch) => {
      const code = ch.codePointAt(0) ?? 0;
      if (code < 0x20 || code === 0x7f) return ' '; // control → word break
      return code <= 0xff ? ch : ''; // outside Latin-1 → dropped
    })
    .join('')
    .replace(/\s+/g, ' ')
    .trim();
  return cleaned || 'Radio';
}
