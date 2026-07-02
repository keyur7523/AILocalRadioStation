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
      'icy-name': `${name} ${frequency}`,
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
