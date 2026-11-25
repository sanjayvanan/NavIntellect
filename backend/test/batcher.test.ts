import { describe, expect, it } from 'vitest';
import { Batcher } from '../src/ingest/batcher.js';
import type { AisMsg } from '../src/ingest/types.js';

const msg = (mmsi: number): AisMsg => ({ kind: 'static', mmsi, ts: new Date(), msgType: 5 });

describe('Batcher', () => {
  it('flushes when maxRows is reached', async () => {
    const flushed: number[] = [];
    const b = new Batcher({ flushIntervalMs: 60_000, maxRows: 3, maxBuffer: 100, onFlush: async (x) => void flushed.push(x.length) });
    b.push(msg(1), msg(2), msg(3), msg(4));
    await b.stop();
    expect(flushed).toEqual([3, 1]);
    expect(b.stats.flushed).toBe(4);
  });

  it('re-queues a failed batch and retries it', async () => {
    let fail = true;
    const seen: number[][] = [];
    const b = new Batcher({
      flushIntervalMs: 60_000, maxRows: 10, maxBuffer: 100,
      onFlush: async (x) => {
        if (fail) { fail = false; throw new Error('db down'); }
        seen.push(x.map((m) => m.mmsi));
      },
    });
    b.push(msg(1), msg(2));
    await b.flush();
    expect(b.stats.failedFlushes).toBe(1);
    expect(b.size).toBe(2);
    await b.flush();
    expect(seen).toEqual([[1, 2]]);
  });

  it('drops oldest messages beyond maxBuffer', () => {
    const b = new Batcher({ flushIntervalMs: 60_000, maxRows: 1000, maxBuffer: 3, onFlush: async () => {} });
    b.push(msg(1), msg(2), msg(3), msg(4), msg(5));
    expect(b.size).toBe(3);
    expect(b.stats.dropped).toBe(2);
  });
});
