import type { PositionMsg } from './types.js';

/** Smallest angle between two courses, in degrees (0-180). */
export const courseChange = (a: number, b: number) => {
  const d = Math.abs(a - b) % 360;
  return d > 180 ? 360 - d : d;
};

/** A turn only counts for ships moving at least this fast: a drifting ship's course is noise. */
const TURN_MIN_SOG = 1;
/** And at most one extra (turn) point per vessel this often, to bound storage. */
const TURN_MIN_GAP_MS = 20_000;

interface Kept {
  t: number;
  cog: number | null;
}

/**
 * Thins position history: keeps at most one stored point per vessel per `intervalMs` (by AIS time),
 * plus a point whenever a moving vessel's course has changed by `turnDegrees` or more since the
 * last stored point, so bends (rivers, harbour approaches) are not cut short. 0 turns that off.
 * The live map (vessel_latest) still receives every position; only vessel_positions is sampled.
 *
 * `select` is pure; call `commit` after the batch is durably written, so a failed (re-queued)
 * batch does not advance the per-vessel state and lose points.
 */
export class HistorySampler {
  private readonly lastKept = new Map<number, Kept>();

  constructor(
    private readonly intervalMs: number,
    private readonly turnDegrees = 0,
  ) {}

  private keep(p: PositionMsg, prev: Kept | undefined): boolean {
    if (prev === undefined) return true;
    const t = p.ts.getTime();
    if (t - prev.t >= this.intervalMs) return true;
    // Out-of-order (older) points are dropped.
    if (this.turnDegrees <= 0 || t - prev.t < TURN_MIN_GAP_MS) return false;
    if (p.cog == null || prev.cog == null || (p.sog ?? 0) < TURN_MIN_SOG) return false;
    return courseChange(p.cog, prev.cog) >= this.turnDegrees;
  }

  select(positions: PositionMsg[]): PositionMsg[] {
    if (this.intervalMs <= 0) return positions;
    const sorted = [...positions].sort((a, b) => a.ts.getTime() - b.ts.getTime());
    const last = new Map<number, Kept>();
    const kept: PositionMsg[] = [];
    for (const p of sorted) {
      if (this.keep(p, last.get(p.mmsi) ?? this.lastKept.get(p.mmsi))) {
        kept.push(p);
        last.set(p.mmsi, { t: p.ts.getTime(), cog: p.cog ?? null });
      }
    }
    return kept;
  }

  commit(kept: PositionMsg[]): void {
    for (const p of kept) {
      const t = p.ts.getTime();
      if (t > (this.lastKept.get(p.mmsi)?.t ?? -Infinity)) this.lastKept.set(p.mmsi, { t, cog: p.cog ?? null });
    }
  }

  get size(): number {
    return this.lastKept.size;
  }
}
