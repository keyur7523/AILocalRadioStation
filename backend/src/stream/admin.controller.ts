import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Put,
} from '@nestjs/common';
import { StationConfigService } from './station-config.service';
import type { StationIdentity } from './station-presets';

interface UpdateStationDto extends Partial<StationIdentity> {
  /** Select a US-timezone preset by id (e.g. "nyc", "cupertino"). */
  presetId?: string;
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
  constructor(private readonly station: StationConfigService) {}

  /** Current identity plus the selectable presets (for building an admin UI). */
  @Get('config')
  getConfig() {
    return { station: this.station.get(), presets: this.station.presets };
  }

  /**
   * Update the station — either `{ presetId }` to apply a US-timezone preset, or
   * any of `{ name, frequency, tagline, city, timeZone }` to set custom values.
   */
  @Put('config')
  updateConfig(@Body() body: UpdateStationDto) {
    if (!body || typeof body !== 'object') {
      throw new BadRequestException('Body must be a JSON object');
    }
    try {
      if (body.presetId !== undefined) {
        this.station.applyPreset(body.presetId);
      } else {
        const { name, frequency, tagline, city, timeZone } = body;
        const patch = { name, frequency, tagline, city, timeZone };
        if (Object.values(patch).every((v) => v === undefined)) {
          throw new BadRequestException(
            'Provide "presetId" or at least one of name/frequency/tagline/city/timeZone',
          );
        }
        this.station.update(patch);
      }
    } catch (err) {
      if (err instanceof BadRequestException) throw err;
      throw new BadRequestException((err as Error).message);
    }
    return this.getConfig();
  }
}
