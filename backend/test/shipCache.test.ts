import { describe, expect, it } from 'vitest';
import { cellDegrees, FULL_DETAIL_ZOOM, ShipCache } from '../src/api/shipCache.js';
import type { LegacyShip } from '../src/ingest/types.js';

const now = Date.now();
const ship = (mmsi: number, lat: number, lon: number, o: Partial<LegacyShip> = {}): LegacyShip => ({
  uuid: String(mmsi), mmsi, track_name: `S${mmsi}`, type: 'Vessel', latitude: lat, longitude: lon,
  speed_over_ground: 10, course_over_ground: 0, true_heading: 0, sensor_timestamp: now - 60_000, message_type__id: 1,
  ...o,
});

const cacheWith = (ships: LegacyShip[]) => {
  const c = new ShipCache();
  c.apply(ships);
  return c;
};

describe('ShipCache map queries', () => {
  it('keeps one representative ship per grid cell when zoomed out, all ships when zoomed in', () => {
    const cell = cellDegrees(4, 8); // 2.8125°
    const c = cacheWith([
      ship(1, 10.1, 10.1, { speed_over_ground: 0 }), // same cell as 2 and 3, but anchored
      ship(2, 10.2, 10.2),                            // moving, recent -> wins the cell
      ship(3, 10.3, 10.3, { sensor_timestamp: now - 3 * 3600_000 }), // moving but stale
      ship(4, 10.1 + cell * 2, 10.1),                 // another cell
    ]);
    const thinned = c.query({ hours: 50, zoom: 4, density: 8 }).map((s) => s.mmsi).sort();
    expect(thinned).toEqual([2, 4]);
    expect(c.query({ hours: 50, zoom: FULL_DETAIL_ZOOM })).toHaveLength(4);
    expect(c.query({ hours: 50 })).toHaveLength(4);
  });

  it('applies hours, bbox (incl. antimeridian) and newest-first limit', () => {
    const c = cacheWith([
      ship(1, 0, 179.5),
      ship(2, 0, -179.5, { sensor_timestamp: now - 1000 }),
      ship(3, 0, 0),
      ship(4, 0, 1, { sensor_timestamp: now - 100 * 3600_000 }),
    ]);
    expect(c.query({ hours: 50 }).map((s) => s.mmsi).sort()).toEqual([1, 2, 3]);
    expect(c.query({ hours: 50, bbox: [170, -5, -170, 5] }).map((s) => s.mmsi).sort()).toEqual([1, 2]);
    expect(c.query({ hours: 50, limit: 1 }).map((s) => s.mmsi)).toEqual([2]);
  });

  it('never moves a ship back in time', () => {
    const c = cacheWith([ship(1, 5, 5, { sensor_timestamp: now })]);
    c.apply([ship(1, 6, 6, { sensor_timestamp: now - 10_000 })]);
    expect(c.query({ hours: 1 })[0]!.latitude).toBe(5);
  });
});
