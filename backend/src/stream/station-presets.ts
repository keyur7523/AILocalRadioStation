/**
 * The station's runtime-editable on-air identity. Everything here can be changed
 * live via the admin API without restarting the audio engine.
 */
export interface StationIdentity {
  name: string;
  frequency: string;
  tagline: string;
  city: string;
  /** IANA timezone the DJ announces local time in (DST-aware). */
  timeZone: string;
}

export interface StationPreset extends StationIdentity {
  /** Stable id used to select the preset via the admin API. */
  id: string;
}

/**
 * One preset per US time zone. Picking a preset switches the station name, city,
 * frequency, tagline, and the timezone the DJ speaks the time in.
 */
export const US_STATION_PRESETS: StationPreset[] = [
  {
    id: 'nyc',
    name: 'Radio NYC',
    frequency: '98.7',
    city: 'New York',
    timeZone: 'America/New_York',
    tagline: "New York's local sound, on a loop",
  },
  {
    id: 'chicago',
    name: 'Radio Chicago',
    frequency: '101.9',
    city: 'Chicago',
    timeZone: 'America/Chicago',
    tagline: "Chicago's local sound, on a loop",
  },
  {
    id: 'denver',
    name: 'Radio Denver',
    frequency: '103.5',
    city: 'Denver',
    timeZone: 'America/Denver',
    tagline: "Denver's local sound, on a loop",
  },
  {
    id: 'phoenix',
    name: 'Radio Phoenix',
    frequency: '92.3',
    city: 'Phoenix',
    // Arizona doesn't observe DST — distinct from America/Denver in summer.
    timeZone: 'America/Phoenix',
    tagline: "Phoenix's local sound, on a loop",
  },
  {
    id: 'cupertino',
    name: 'Radio Cupertino',
    frequency: '104.5',
    city: 'Cupertino',
    timeZone: 'America/Los_Angeles',
    tagline: "Cupertino's local sound, on a loop",
  },
  {
    id: 'anchorage',
    name: 'Radio Anchorage',
    frequency: '106.1',
    city: 'Anchorage',
    timeZone: 'America/Anchorage',
    tagline: "Anchorage's local sound, on a loop",
  },
  {
    id: 'honolulu',
    name: 'Radio Honolulu',
    frequency: '99.5',
    city: 'Honolulu',
    timeZone: 'Pacific/Honolulu',
    tagline: "Honolulu's local sound, on a loop",
  },
];
