import type { PositionMsg } from './types.js';

/**
 * Thins position history: keeps at most one stored point per vessel per `intervalMs` (by AIS time).
 * The live map (vessel_latest) still receives every position; only vessel_positions is sampled.
 *
 * `select` is pure; call `commit` after the batch is durably written, so a failed (re-queued)
 * batch does not advance the per-vessel state and lose points.
 */
export class HistorySampler {
  private readonly lastKept = new Map<number, number>();

  constructor(private readonly intervalMs: number) {}

  select(positions: PositionMsg[]): PositionMsg[] {
    if (this.intervalMs <= 0) return positions;
    const sorted = [...positions].sort((a, b) => a.ts.getTime() - b.ts.getTime());
    const last = new Map<number, number>();
    const kept: PositionMsg[] = [];
    for (const p of sorted) {
      const t = p.ts.getTime();
      const prev = last.get(p.mmsi) ?? this.lastKept.get(p.mmsi);
      // Keep the first point, then one per interval. Out-of-order (older) points are dropped.
      if (prev === undefined || t - prev >= this.intervalMs) {
        kept.push(p);
        last.set(p.mmsi, t);
      }
    }
    return kept;
  }

  commit(kept: PositionMsg[]): void {
    for (const p of kept) {
      const t = p.ts.getTime();
      if (t > (this.lastKept.get(p.mmsi) ?? -Infinity)) this.lastKept.set(p.mmsi, t);
    }
  }

  get size(): number {
    return this.lastKept.size;
  }
}
