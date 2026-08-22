import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Header,
  Put,
} from '@nestjs/common';
import { ADMIN_HTML } from './admin.page';
import { StationConfigService } from './station-config.service';
import type { StationIdentity } from './station-presets';
import { VoiceConfigService } from './tts/voice-config.service';

interface UpdateStationDto extends Partial<StationIdentity> {
  /** Select a US-timezone preset by id (e.g. "nyc", "cupertino"). */
  presetId?: string;
  /** Switch the DJ voice by id (e.g. "en_US-ryan-high"). */
  voiceId?: string;
}

/**
 * Admin API for the station's on-air identity. Changes apply live (the DJ's
 * spoken timezone, the `/station` info, and ICY metadata all pick them up).
 *
 * NOTE: these endpoints are currently **unauthenticated** by request. Anyone who
 * can reach the backend can change the station. Put them behind an auth guard
 * (e.g. a shared ADMIN_TOKEN) before exposing this publicly.
 */
@Controller('admin')
export class AdminController {
  constructor(
    private readonly station: StationConfigService,
    private readonly voices: VoiceConfigService,
  ) {}

  /** The admin web UI (a self-contained page that drives the API below). */
  @Get()
  @Header('Content-Type', 'text/html; charset=utf-8')
  page(): string {
    return ADMIN_HTML;
  }

  /** Current identity plus the selectable presets (for building an admin UI). */
  @Get('config')
  getConfig() {
    return {
      station: this.station.get(),
      presets: this.station.presets,
      voices: this.voices.list(),
      voiceId: this.voices.current?.id ?? null,
    };
  }

  /**
   * Update the station — `{ presetId }` to apply a US-timezone preset, any of
   * `{ name, frequency, tagline, city, timeZone }` for custom values, and/or
   * `{ voiceId }` to switch the DJ voice. Voice can be changed on its own.
   */
  @Put('config')
  updateConfig(@Body() body: UpdateStationDto) {
    if (!body || typeof body !== 'object') {
      throw new BadRequestException('Body must be a JSON object');
    }
    try {
      if (body.voiceId !== undefined) {
        this.voices.select(body.voiceId);
      }
      if (body.presetId !== undefined) {
        this.station.applyPreset(body.presetId);
      } else {
        const { name, frequency, tagline, city, timeZone } = body;
        const patch = { name, frequency, tagline, city, timeZone };
        const noStationChange = Object.values(patch).every(
          (v) => v === undefined,
        );
        // A voice-only update is valid; otherwise something must be provided.
        if (noStationChange && body.voiceId === undefined) {
          throw new BadRequestException(
            'Provide "voiceId", "presetId", or at least one of name/frequency/tagline/city/timeZone',
          );
        }
        if (!noStationChange) this.station.update(patch);
      }
    } catch (err) {
      if (err instanceof BadRequestException) throw err;
      throw new BadRequestException((err as Error).message);
    }
    return this.getConfig();
  }
}
