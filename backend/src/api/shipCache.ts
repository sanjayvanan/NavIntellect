import type { Redis } from 'ioredis';
import { LEGACY_SHIP_COLUMNS } from '../db/legacy.js';
import { pool } from '../db/pool.js';
import type { LegacyShip } from '../ingest/types.js';
import { logger } from '../shared/logger.js';
import { CHANNELS } from '../shared/redis.js';
import type { BBox } from './errors.js';

/** Below this zoom the map gets one representative ship per grid cell. */
export const FULL_DETAIL_ZOOM = 10;
/** Default grid cells per 256 px map tile (16 -> one ship per ~16 px square). */
export const DEFAULT_DENSITY = 16;
/** Grid cell size in degrees for a zoom level and density (cells per 256 px tile side). */
export const cellDegrees = (zoom: number, density = DEFAULT_DENSITY) => 360 / (2 ** Math.floor(zoom) * density);

const RESYNC_MS = 5 * 60_000;
const RECENT_MS = 30 * 60_000;
const MAX_AGE_MS = 30 * 86_400_000; // trackList accepts hours <= 720

export interface MapQuery {
  hours: number;
  bbox?: BBox;
  zoom?: number;
  /** Cells per 256 px tile side: higher = more ships when zoomed out. */
  density?: number;
  limit?: number;
}

const inBox = (s: LegacyShip, b: BBox) =>
  s.latitude >= b[1] && s.latitude <= b[3] &&
  (b[0] <= b[2] ? s.longitude >= b[0] && s.longitude <= b[2] : s.longitude >= b[0] || s.longitude <= b[2]);

/** Representative-ship priority inside a grid cell: recently heard, then moving, then newest. */
const rank = (s: LegacyShip, now: number) =>
  (now - s.sensor_timestamp < RECENT_MS ? 2 : 0) + (s.speed_over_ground >= 1 ? 1 : 0);

/**
 * In-memory copy of the live map (one row per vessel, legacy shape), so map requests never wait on
 * the database: the DB may be far away (Supabase region) and a pan would otherwise cost a round
 * trip plus hundreds of KB of rows. Loaded at startup, kept current from the ingestor's Redis
 * updates, and fully re-synced every few minutes as a safety net. ~30k ships ≈ 10 MB.
 */
export class ShipCache {
  private ships = new Map<number, LegacyShip>();
  private timer: NodeJS.Timeout | null = null;
  private loaded = false;

  async start(subscriber: Redis) {
    await subscriber.subscribe(CHANNELS.vessels);
    subscriber.on('message', (channel: string, payload: string) => {
      if (channel !== CHANNELS.vessels) return;
      try {
        this.apply(JSON.parse(payload) as LegacyShip[]);
      } catch (err) {
        logger.warn({ err }, 'ship cache: bad payload');
      }
    });
    // If the DB is unreachable at startup, the route falls back to SQL until a resync succeeds.
    await this.resync().catch((err) => logger.error({ err }, 'ship cache initial load failed'));
    this.timer = setInterval(() => {
      this.resync().catch((err) => logger.error({ err }, 'ship cache resync failed'));
    }, RESYNC_MS);
    this.timer.unref();
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
  }

  get size() {
    return this.ships.size;
  }

  get ready() {
    return this.loaded;
  }

  /** Reloads everything from vessel_latest (picks up name changes and pruned ships). */
  async resync() {
    const t0 = Date.now();
    const { rows } = await pool.query<LegacyShip>(
      `SELECT ${LEGACY_SHIP_COLUMNS} FROM vessel_latest l JOIN vessels v USING (mmsi)
       WHERE l.ts >= now() - make_interval(secs => $1 / 1000.0)`,
      [MAX_AGE_MS],
    );
    const next = new Map<number, LegacyShip>();
    for (const r of rows) next.set(r.mmsi, r);
    // Keep live updates that arrived while the query was running.
    for (const [mmsi, s] of this.ships) {
      const fresh = next.get(mmsi);
      if (fresh && s.sensor_timestamp > fresh.sensor_timestamp) next.set(mmsi, s);
    }
    this.ships = next;
    this.loaded = true;
    logger.debug({ ships: next.size, ms: Date.now() - t0 }, 'ship cache resynced');
  }

  /** Applies live updates; never moves a ship back in time. */
  apply(updates: LegacyShip[]) {
    for (const s of updates) {
      const cur = this.ships.get(s.mmsi);
      if (!cur || s.sensor_timestamp >= cur.sensor_timestamp) this.ships.set(s.mmsi, s);
    }
  }

  /** Same semantics as the SQL trackList: hours window, optional bbox, zoom thinning, newest-first limit. */
  query(q: MapQuery): LegacyShip[] {
    const now = Date.now();
    const since = now - q.hours * 3600_000;
    let out: LegacyShip[] = [];
    for (const s of this.ships.values()) {
      if (s.sensor_timestamp < since) continue;
      if (q.bbox && !inBox(s, q.bbox)) continue;
      out.push(s);
    }
    if (q.zoom !== undefined && q.zoom < FULL_DETAIL_ZOOM) {
      const c = cellDegrees(q.zoom, q.density);
      const cells = new Map<string, { ship: LegacyShip; count: number }>();
      for (const s of out) {
        const key = `${Math.floor(s.longitude / c)}:${Math.floor(s.latitude / c)}`;
        const cur = cells.get(key);
        if (!cur) cells.set(key, { ship: s, count: 1 });
        else {
          cur.count++;
          if (rank(s, now) > rank(cur.ship, now) || (rank(s, now) === rank(cur.ship, now) && s.sensor_timestamp > cur.ship.sensor_timestamp)) {
            cur.ship = s;
          }
        }
      }
      // cell_count: how many ships this one stands for, so map clusters can show true totals.
      out = [...cells.values()].map(({ ship, count }) => (count > 1 ? { ...ship, cell_count: count } : ship));
    }
    if (q.limit && out.length > q.limit) {
      out.sort((a, b) => b.sensor_timestamp - a.sensor_timestamp);
      out = out.slice(0, q.limit);
    }
    return out;
  }
}
