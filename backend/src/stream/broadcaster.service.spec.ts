import { BroadcasterService, type Listener } from './broadcaster.service';
import type { SequencerService } from './dj/sequencer.service';
import type { StationConfigService } from './station-config.service';

function broadcaster(): BroadcasterService {
  return new BroadcasterService(
    {} as SequencerService,
    {} as StationConfigService,
  );
}

const listener = (): Listener => ({ write: () => true });

describe('BroadcasterService listener cap', () => {
  const saved = process.env.STREAM_MAX_LISTENERS;
  afterEach(() => {
    if (saved === undefined) delete process.env.STREAM_MAX_LISTENERS;
    else process.env.STREAM_MAX_LISTENERS = saved;
  });

  it('is full once STREAM_MAX_LISTENERS are connected', () => {
    process.env.STREAM_MAX_LISTENERS = '2';
    const b = broadcaster();
    const first = listener();
    b.addListener(first);
    expect(b.full).toBe(false);
    b.addListener(listener());
    expect(b.full).toBe(true);
    b.removeListener(first);
    expect(b.full).toBe(false);
  });
});
