import { Writable } from 'node:stream';
import { PcmFeeder } from './pcm-feeder';

/** A sink that holds each write until the test releases it. */
function heldSink() {
  const pending: Array<() => void> = [];
  let inFlight = 0;
  let maxInFlight = 0;
  const sink = new Writable({
    write(_chunk, _enc, done) {
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      pending.push(() => {
        inFlight--;
        done();
      });
    },
  });
  const release = async () => {
    pending.shift()?.();
    await new Promise((r) => setImmediate(r));
  };
  return { sink, release, maxInFlight: () => maxInFlight };
}

const chunk = (n: number) => Buffer.alloc(n);

describe('PcmFeeder', () => {
  it('keeps exactly one write outstanding however much is queued', async () => {
    const { sink, release, maxInFlight } = heldSink();
    const feeder = new PcmFeeder(sink, 0, () => undefined);
    for (let i = 0; i < 10; i++) feeder.push(chunk(100));
    for (let i = 0; i < 10; i++) await release();
    expect(maxInFlight()).toBe(1);
  });

  it('reports the true amount waiting as chunks are handed over', async () => {
    const { sink, release } = heldSink();
    const feeder = new PcmFeeder(sink, 0, () => undefined);
    feeder.push(chunk(100));
    feeder.push(chunk(100));
    feeder.push(chunk(100));
    expect(feeder.buffered).toBe(300);
    await release();
    expect(feeder.buffered).toBe(200);
    await release();
    expect(feeder.buffered).toBe(100);
  });

  it('asks for more once below the low-water mark — not only when empty', async () => {
    const { sink, release } = heldSink();
    const lowCalls: number[] = [];
    const feeder = new PcmFeeder(sink, 250, () =>
      lowCalls.push(feeder.buffered),
    );
    for (let i = 0; i < 5; i++) feeder.push(chunk(100)); // 500 queued
    await release(); // 400
    await release(); // 300
    expect(lowCalls).toEqual([]);
    await release(); // 200 — below 250
    expect(lowCalls[0]).toBe(200);
  });

  it('drops everything and stops writing once closed', async () => {
    const { sink, release, maxInFlight } = heldSink();
    const feeder = new PcmFeeder(sink, 0, () => undefined);
    feeder.push(chunk(100));
    feeder.push(chunk(100));
    feeder.close();
    feeder.push(chunk(100));
    expect(feeder.buffered).toBe(0);
    await release();
    expect(maxInFlight()).toBe(1);
  });
});
