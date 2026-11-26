import { describe, expect, it } from 'vitest';
import { courseChange, HistorySampler } from '../src/ingest/sampler.js';
import type { PositionMsg } from '../src/ingest/types.js';

const pos = (mmsi: number, sec: number) => ({ kind: 'position', mmsi, ts: new Date(sec * 1000) }) as PositionMsg;
const move = (sec: number, cog: number, sog = 8) => ({ kind: 'position', mmsi: 1, ts: new Date(sec * 1000), cog, sog }) as PositionMsg;
const secs = (ps: PositionMsg[]) => ps.map((p) => [p.mmsi, p.ts.getTime() / 1000]);

describe('HistorySampler', () => {
  it('keeps one point per vessel per interval, independent per vessel', () => {
    const s = new HistorySampler(120_000);
    const kept = s.select([pos(1, 0), pos(1, 60), pos(2, 30), pos(1, 120), pos(2, 100), pos(1, 200)]);
    expect(secs(kept)).toEqual([[1, 0], [2, 30], [1, 120]]);
  });

  it('only advances state on commit, so a failed batch can be retried without losing points', () => {
    const s = new HistorySampler(120_000);
    const first = s.select([pos(1, 0)]);
    expect(secs(s.select([pos(1, 0)]))).toEqual([[1, 0]]); // not committed yet: retry keeps it
    s.commit(first);
    expect(s.select([pos(1, 60)])).toEqual([]);
    expect(secs(s.select([pos(1, 130)]))).toEqual([[1, 130]]);
  });

  it('drops out-of-order points older than the last stored one', () => {
    const s = new HistorySampler(120_000);
    s.commit(s.select([pos(1, 500)]));
    expect(s.select([pos(1, 100)])).toEqual([]);
  });

  it('keeps everything when the interval is 0', () => {
    const s = new HistorySampler(0);
    expect(s.select([pos(1, 0), pos(1, 1)])).toHaveLength(2);
  });

  it('also keeps a point when a moving ship turns, so bends are not cut short', () => {
    const s = new HistorySampler(120_000, 20);
    const kept = s.select([
      move(0, 90),
      move(30, 95), // small change: dropped
      move(60, 130), // turned 40°: kept
      move(70, 170), // turned again, but only 10 s later: dropped
      move(100, 175), // 45° since the last kept point: kept
      move(130, 300, 0.3), // course of a drifting ship: ignored
      move(220, 176), // the normal 2-minute point
    ]);
    expect(secs(kept)).toEqual([[1, 0], [1, 60], [1, 100], [1, 220]]);
    expect(courseChange(350, 10)).toBe(20);
    expect(courseChange(10, 190)).toBe(180);
  });
});
