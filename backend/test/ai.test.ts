import { describe, expect, it } from 'vitest';
import { pacificDay } from '../src/ai/budget.js';
import { distanceNm, summarizeTrack } from '../src/ai/tools.js';

describe('AI helpers', () => {
  it('measures distance in nautical miles', () => {
    expect(distanceNm([0, 0], [0, 1])).toBeCloseTo(60.04, 1); // one degree of latitude ≈ 60 nm
    expect(distanceNm([10, 20], [10, 20])).toBe(0);
  });

  it('summarises a track without sending every point', () => {
    const coords = Array.from({ length: 101 }, (_, i) => [i * 0.01, 0]);
    const t0 = Date.UTC(2026, 10, 26, 0, 0);
    const times = coords.map((_, i) => t0 + i * 60_000); // one point a minute, 100 minutes
    const s = summarizeTrack({ geometry: { type: 'LineString', coordinates: coords }, properties: { points: 101, max_sog: 12.3, times } }, 6);
    expect(s).toMatchObject({ points: 101, max_speed_kn: 12.3, start: { time: '2026-11-26T00:00Z', lon: 0 }, end: { lon: 1 } });
    expect(s.distance_nm).toBeCloseTo(60, 0);
    expect(s.avg_speed_kn).toBeCloseTo(36, 0); // 60 nm in 100 min
    expect(s.waypoints!.length).toBeLessThanOrEqual(9);
    expect(summarizeTrack({ geometry: null, properties: { points: 0, max_sog: null, times: null } }, 24)).toEqual({
      hours: 24, points: 0, note: 'No positions in this period.',
    });
  });

  it('counts free-tier days in Pacific time', () => {
    expect(pacificDay(new Date('2026-11-26T07:59:00Z'))).toBe('2026-11-25'); // 23:59 PST
    expect(pacificDay(new Date('2026-11-26T08:00:00Z'))).toBe('2026-11-26');
  });
});
