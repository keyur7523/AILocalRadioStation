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

describe('BroadcasterService fan-out', () => {
  /** A broadcaster wired to a fake engine; returns a way to push one chunk. */
  function live() {
    let onChunk: (c: Buffer) => void = () => {};
    const b = new BroadcasterService(
      {
        start: (hooks: { onChunk: (c: Buffer) => void }) => {
          onChunk = hooks.onChunk;
        },
      } as unknown as SequencerService,
      { get: () => ({}) } as unknown as StationConfigService,
    );
    b.onModuleInit();
    return { b, push: (c: Buffer) => onChunk(c) };
  }

  const count = (b: BroadcasterService) => b.getStationInfo().listeners;

  it('sends every chunk to every listener', () => {
    const { b, push } = live();
    const got: string[] = [];
    b.addListener({ write: (c) => got.push(`1:${c.toString()}`) > 0 });
    b.addListener({ write: (c) => got.push(`2:${c.toString()}`) > 0 });
    push(Buffer.from('x'));
    expect(got).toEqual(['1:x', '2:x']);
  });

  it('drops a listener too far behind, and closes its connection', () => {
    const { b, push } = live();
    const end = jest.fn();
    b.addListener({ write: () => true, writableLength: 2 * 1024 * 1024, end });
    push(Buffer.from('x'));
    expect(end).toHaveBeenCalled();
    expect(count(b)).toBe(0);
  });

  it('prunes closed connections and ones whose write throws, and keeps going', () => {
    const { b, push } = live();
    const healthy = jest.fn(() => true);
    b.addListener({ write: () => true, destroyed: true });
    b.addListener({
      write: () => {
        throw new Error('socket gone');
      },
    });
    b.addListener({ write: healthy });
    push(Buffer.from('x'));
    expect(healthy).toHaveBeenCalledTimes(1);
    expect(count(b)).toBe(1);
  });
});
