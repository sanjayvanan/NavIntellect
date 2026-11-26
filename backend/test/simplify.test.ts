import { describe, expect, it } from 'vitest';
import { M_PER_DEG, optimizeTrack, perpendicularDistance, simplifyLine, type TrackPoint } from '../src/shared/simplify.js';

const MIN = 60_000;
const pt = (min: number, lat: number, lon: number): TrackPoint => ({ ts: min * MIN, lat, lon, sog: 10 });

describe('track simplification (Douglas–Peucker)', () => {
  it('measures the distance from a point to a segment', () => {
    expect(perpendicularDistance([5, 3], [0, 0], [10, 0])).toBe(3); // foot inside the segment
    expect(perpendicularDistance([13, 4], [0, 0], [10, 0])).toBe(5); // past the end: to the end point
    expect(perpendicularDistance([3, 4], [0, 0], [0, 0])).toBe(5); // zero-length segment
  });

  it('drops points within the tolerance and keeps the corners', () => {
    // An L: along x, then up y. Small wobbles (1 m) go; the corner (100, 0) stays.
    const xy: [number, number][] = [[0, 0], [25, 1], [50, -1], [75, 1], [100, 0], [100, 50], [100, 100]];
    expect(simplifyLine(xy, 5)).toEqual([0, 4, 6]);
    expect(simplifyLine(xy, 0)).toEqual([0, 1, 2, 3, 4, 5, 6]); // 0 = keep everything
    expect(simplifyLine(xy.slice(0, 2), 5)).toEqual([0, 1]);
  });

  it('handles long tracks without running out of stack', () => {
    const straight = Array.from({ length: 50_000 }, (_, i): [number, number] => [i, 0]);
    expect(simplifyLine(straight, 10)).toEqual([0, 49_999]);
    const zigzag = Array.from({ length: 50_000 }, (_, i): [number, number] => [i, (i % 2) * 100]);
    expect(simplifyLine(zigzag, 10).length).toBeGreaterThan(40_000); // sharp turns everywhere: most stay
  });

  it('simplifies a real-looking track, keeps times, and never simplifies across a gap', () => {
    // Straight run north every 2 min (60 points), a 47-minute gap, then a straight run east.
    const north = Array.from({ length: 60 }, (_, i) => pt(i * 2, 13 + i * 0.001, 100.5));
    const east = Array.from({ length: 30 }, (_, i) => pt(165 + i * 2, 13.2 + 0.00001 * (i % 2), 100.6 + i * 0.001));
    const { points, breaks } = optimizeTrack([...north, ...east], 0.0004 * M_PER_DEG);
    // Each straight run keeps only its two ends; the gap is reported between them.
    expect(points).toEqual([north[0], north[59], east[0], east[29]]);
    expect(breaks).toEqual([2]);
  });

  it('keeps the same tolerance on the ground at high latitudes', () => {
    // 30 m sideways bump at 70°N (where a degree of longitude is only ~38 km): kept at 20 m, gone at 44 m.
    const dLon = 30 / (Math.cos((70 * Math.PI) / 180) * M_PER_DEG);
    const track = [pt(0, 70, 10), pt(1, 70.001, 10 + dLon), pt(2, 70.002, 10)];
    expect(optimizeTrack(track, 20).points).toHaveLength(3);
    expect(optimizeTrack(track, 44).points).toHaveLength(2);
  });
});
