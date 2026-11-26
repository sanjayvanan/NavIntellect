/**
 * Ship track simplification (Ramer–Douglas–Peucker): drops points that lie within a tolerance of
 * the line through their neighbours, keeping the shape of the path with far fewer points.
 *
 * Distances are measured in metres on a local flat projection, so a tolerance means the same on
 * the ground at every latitude (a degree of longitude shrinks towards the poles).
 * Gaps in reception are found first and never simplified across: each stretch between gaps is
 * simplified on its own, and the gaps are returned, so a straight stretch that lost its middle
 * points is not mistaken for a gap (and a real gap is not hidden).
 */

export interface TrackPoint {
  ts: number; // epoch ms
  lat: number;
  lon: number;
  sog: number | null;
}

/** Metres per degree of latitude (and of longitude at the equator). */
export const M_PER_DEG = 111_320;

/** No report for longer than this, while moving further than GAP_MIN_M, is a gap in reception. */
export const GAP_MS = 10 * 60_000;
export const GAP_MIN_M = 0.3 * 1852;

/** Rough ground distance in metres between two points (equirectangular; fine at these scales). */
export function groundDistance(a: TrackPoint, b: TrackPoint): number {
  const dLat = b.lat - a.lat;
  const dLon = (b.lon - a.lon) * Math.cos(((a.lat + b.lat) / 2) * (Math.PI / 180));
  return Math.hypot(dLat, dLon) * M_PER_DEG;
}

/**
 * Perpendicular distance from `p` to the segment `a`–`b` (to the nearest end when the foot of
 * the perpendicular falls outside the segment), all as [x, y] in metres.
 */
export function perpendicularDistance(p: [number, number], a: [number, number], b: [number, number]): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len2 = dx * dx + dy * dy;
  if (len2 === 0) return Math.hypot(p[0] - a[0], p[1] - a[1]);
  const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2));
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
}

/**
 * Douglas–Peucker on [x, y] points in metres: returns the indexes to keep (first and last always).
 * Iterative (an explicit stack), so a long track cannot overflow the call stack.
 */
export function simplifyLine(xy: [number, number][], toleranceM: number): number[] {
  const n = xy.length;
  if (n <= 2 || toleranceM <= 0) return xy.map((_, i) => i);
  const keep = new Uint8Array(n);
  keep[0] = 1;
  keep[n - 1] = 1;
  const stack: [number, number][] = [[0, n - 1]];
  while (stack.length) {
    const [start, end] = stack.pop()!;
    let maxD = -1;
    let index = -1;
    for (let i = start + 1; i < end; i++) {
      const d = perpendicularDistance(xy[i]!, xy[start]!, xy[end]!);
      if (d > maxD) {
        maxD = d;
        index = i;
      }
    }
    // Furthest point outside the tolerance: keep it and look at both halves; else drop them all.
    if (index !== -1 && maxD > toleranceM) {
      keep[index] = 1;
      stack.push([start, index], [index, end]);
    }
  }
  const out: number[] = [];
  for (let i = 0; i < n; i++) if (keep[i]) out.push(i);
  return out;
}

/** One stretch of track -> metres on a flat projection centred on it. */
function project(run: TrackPoint[]): [number, number][] {
  const lat0 = run.reduce((s, p) => s + p.lat, 0) / run.length;
  const k = Math.cos(lat0 * (Math.PI / 180)) * M_PER_DEG;
  const lon0 = run[0]!.lon;
  return run.map((p) => [(p.lon - lon0) * k, (p.lat - lat0) * M_PER_DEG]);
}

/**
 * Simplifies a time-ordered track. Returns the kept points (with their time and speed) and
 * `breaks`: indexes into `points` where a new stretch starts after a gap in reception
 * (between points[i - 1] and points[i] the ship was not heard for over GAP_MS).
 */
export function optimizeTrack(points: TrackPoint[], toleranceM: number): { points: TrackPoint[]; breaks: number[] } {
  // 1. Split into stretches at gaps (reported as breaks) and at antimeridian crossings (not gaps;
  //    split only so the flat projection stays valid).
  const runs: { run: TrackPoint[]; afterGap: boolean }[] = [];
  let current: TrackPoint[] = [];
  let afterGap = false;
  for (let i = 0; i < points.length; i++) {
    const p = points[i]!;
    const prev = points[i - 1];
    if (prev) {
      const gap = p.ts - prev.ts > GAP_MS && groundDistance(prev, p) > GAP_MIN_M;
      if (gap || Math.abs(p.lon - prev.lon) > 180) {
        runs.push({ run: current, afterGap });
        current = [];
        afterGap = gap;
      }
    }
    current.push(p);
  }
  if (current.length) runs.push({ run: current, afterGap });

  // 2. Simplify each stretch on its own; its first and last points are always kept.
  const out: TrackPoint[] = [];
  const breaks: number[] = [];
  for (const { run, afterGap: gapBefore } of runs) {
    if (!run.length) continue;
    if (gapBefore && out.length) breaks.push(out.length);
    for (const i of simplifyLine(project(run), toleranceM)) out.push(run[i]!);
  }
  return { points: out, breaks };
}
