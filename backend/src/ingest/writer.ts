import type pg from 'pg';
import { withTransaction } from '../db/pool.js';
import { LEGACY_SHIP_COLUMNS } from '../db/legacy.js';
import type { AisMsg, LegacyShip, PositionMsg, StaticMsg } from './types.js';

export interface WriteResult {
  positionsInserted: number;
  /** Vessels whose latest position actually advanced in this batch (legacy shape, for WS fan-out). */
  updated: LegacyShip[];
  /** The latest positions that advanced, for the alert engine. */
  latest: PositionMsg[];
}

/**
 * Persists one batch in a single transaction:
 *   1. upsert vessels (identity + name hints + static data)
 *   2. bulk insert position history (daily partitions), deduped by (mmsi, ts)
 *   3. upsert vessel_latest, only moving forward in time
 */
export async function writeBatch(batch: AisMsg[]): Promise<WriteResult> {
  const positions: PositionMsg[] = [];
  const statics = new Map<number, StaticMsg>();
  for (const m of batch) {
    if (m.kind === 'position') positions.push(m);
    else statics.set(m.mmsi, mergeStatic(statics.get(m.mmsi), m));
  }

  // Latest position per MMSI within the batch.
  const latestByMmsi = new Map<number, PositionMsg>();
  for (const p of positions) {
    const cur = latestByMmsi.get(p.mmsi);
    if (!cur || p.ts > cur.ts) latestByMmsi.set(p.mmsi, p);
  }

  return withTransaction(async (client) => {
    await upsertVessels(client, latestByMmsi, statics);
    const positionsInserted = await insertPositions(client, positions);
    const updated = await upsertLatest(client, [...latestByMmsi.values()]);
    const advanced = new Set(updated.map((u) => u.mmsi));
    return {
      positionsInserted,
      updated,
      latest: [...latestByMmsi.values()].filter((p) => advanced.has(p.mmsi)),
    };
  });
}

function mergeStatic(prev: StaticMsg | undefined, next: StaticMsg): StaticMsg {
  if (!prev) return next;
  const merged: StaticMsg = { ...prev };
  for (const [k, v] of Object.entries(next)) if (v != null) (merged as unknown as Record<string, unknown>)[k] = v;
  return merged;
}

async function upsertVessels(client: pg.PoolClient, latest: Map<number, PositionMsg>, statics: Map<number, StaticMsg>) {
  const mmsis = new Set<number>([...latest.keys(), ...statics.keys()]);
  if (mmsis.size === 0) return;
  const cols = {
    mmsi: [] as number[], seen: [] as Date[], nameHint: [] as (string | null)[], hasStatic: [] as boolean[],
    name: [] as (string | null)[], callsign: [] as (string | null)[], imo: [] as (number | null)[],
    shipType: [] as (number | null)[], label: [] as (string | null)[],
    a: [] as (number | null)[], b: [] as (number | null)[], c: [] as (number | null)[], d: [] as (number | null)[],
    draught: [] as (number | null)[], destination: [] as (string | null)[], eta: [] as (Date | null)[],
  };
  for (const mmsi of [...mmsis].sort((x, y) => x - y)) {
    const p = latest.get(mmsi);
    const s = statics.get(mmsi);
    cols.mmsi.push(mmsi);
    cols.seen.push(p && s ? (p.ts > s.ts ? p.ts : s.ts) : (p?.ts ?? s!.ts));
    cols.nameHint.push(p?.nameHint ?? null);
    cols.hasStatic.push(!!s);
    cols.name.push(s?.name ?? null);
    cols.callsign.push(s?.callsign ?? null);
    cols.imo.push(s?.imo ?? null);
    cols.shipType.push(s?.shipType ?? null);
    cols.label.push(s?.shipTypeLabel ?? null);
    cols.a.push(s?.dimA ?? null); cols.b.push(s?.dimB ?? null); cols.c.push(s?.dimC ?? null); cols.d.push(s?.dimD ?? null);
    cols.draught.push(s?.draught ?? null);
    cols.destination.push(s?.destination ?? null);
    cols.eta.push(s?.eta ?? null);
  }
  // Static fields overwrite when present.
  await client.query(
    `INSERT INTO vessels AS v (mmsi, first_seen, last_seen, name, callsign, imo, ship_type, ship_type_label,
                               dim_a, dim_b, dim_c, dim_d, draught, destination, eta, static_updated_at)
     SELECT t.mmsi, t.seen, t.seen, t.name, t.callsign, t.imo, t.ship_type, t.label,
            t.a, t.b, t.c, t.d, t.draught, t.destination, t.eta, CASE WHEN t.has_static THEN t.seen END
     FROM unnest($1::int4[], $2::timestamptz[], $3::text[], $4::bool[], $5::text[], $6::text[], $7::int4[],
                 $8::int2[], $9::text[], $10::int2[], $11::int2[], $12::int2[], $13::int2[], $14::real[],
                 $15::text[], $16::timestamptz[])
       AS t(mmsi, seen, name_hint, has_static, name, callsign, imo, ship_type, label, a, b, c, d, draught, destination, eta)
     ON CONFLICT (mmsi) DO UPDATE SET
       last_seen         = GREATEST(v.last_seen, EXCLUDED.last_seen),
       name              = COALESCE(EXCLUDED.name, v.name),
       callsign          = COALESCE(EXCLUDED.callsign, v.callsign),
       imo               = COALESCE(EXCLUDED.imo, v.imo),
       ship_type         = COALESCE(EXCLUDED.ship_type, v.ship_type),
       ship_type_label   = COALESCE(EXCLUDED.ship_type_label, v.ship_type_label),
       dim_a             = COALESCE(EXCLUDED.dim_a, v.dim_a),
       dim_b             = COALESCE(EXCLUDED.dim_b, v.dim_b),
       dim_c             = COALESCE(EXCLUDED.dim_c, v.dim_c),
       dim_d             = COALESCE(EXCLUDED.dim_d, v.dim_d),
       draught           = COALESCE(EXCLUDED.draught, v.draught),
       destination       = COALESCE(EXCLUDED.destination, v.destination),
       eta               = COALESCE(EXCLUDED.eta, v.eta),
       static_updated_at = COALESCE(EXCLUDED.static_updated_at, v.static_updated_at)`,
    [cols.mmsi, cols.seen, cols.nameHint, cols.hasStatic, cols.name, cols.callsign, cols.imo, cols.shipType,
     cols.label, cols.a, cols.b, cols.c, cols.d, cols.draught, cols.destination, cols.eta],
  );
  // MetaData.ShipName only fills a name that real static data hasn't provided yet.
  await client.query(
    `UPDATE vessels v SET name = t.name_hint
     FROM unnest($1::int4[], $2::text[]) AS t(mmsi, name_hint)
     WHERE v.mmsi = t.mmsi AND v.name IS NULL AND t.name_hint IS NOT NULL`,
    [cols.mmsi, cols.nameHint],
  );
}

async function insertPositions(client: pg.PoolClient, positions: PositionMsg[]): Promise<number> {
  if (positions.length === 0) return 0;
  const res = await client.query(
    `INSERT INTO vessel_positions (ts, mmsi, geom, sog, cog, heading, rot, nav_status, msg_type)
     SELECT t.ts, t.mmsi, ST_SetSRID(ST_MakePoint(t.lon, t.lat), 4326)::geography,
            t.sog, t.cog, t.heading, t.rot, t.nav_status, t.msg_type
     FROM unnest($1::timestamptz[], $2::int4[], $3::float8[], $4::float8[], $5::real[], $6::real[],
                 $7::int2[], $8::int2[], $9::int2[], $10::int2[])
       AS t(ts, mmsi, lat, lon, sog, cog, heading, rot, nav_status, msg_type)
     ON CONFLICT DO NOTHING`,
    [
      positions.map((p) => p.ts), positions.map((p) => p.mmsi), positions.map((p) => p.lat),
      positions.map((p) => p.lon), positions.map((p) => p.sog), positions.map((p) => p.cog),
      positions.map((p) => p.heading), positions.map((p) => p.rot), positions.map((p) => p.navStatus),
      positions.map((p) => p.msgType),
    ],
  );
  return res.rowCount ?? 0;
}

async function upsertLatest(client: pg.PoolClient, latest: PositionMsg[]): Promise<LegacyShip[]> {
  if (latest.length === 0) return [];
  latest.sort((a, b) => a.mmsi - b.mmsi); // stable lock order across concurrent writers
  const { rows } = await client.query<LegacyShip>(
    `WITH up AS (
       INSERT INTO vessel_latest AS cur (mmsi, ts, lat, lon, geom, sog, cog, heading, rot, nav_status, msg_type, updated_at)
       SELECT t.mmsi, t.ts, t.lat, t.lon, ST_SetSRID(ST_MakePoint(t.lon, t.lat), 4326)::geography,
              t.sog, t.cog, t.heading, t.rot, t.nav_status, t.msg_type, now()
       FROM unnest($1::int4[], $2::timestamptz[], $3::float8[], $4::float8[], $5::real[], $6::real[],
                   $7::int2[], $8::int2[], $9::int2[], $10::int2[])
         AS t(mmsi, ts, lat, lon, sog, cog, heading, rot, nav_status, msg_type)
       ON CONFLICT (mmsi) DO UPDATE SET
         ts = EXCLUDED.ts, lat = EXCLUDED.lat, lon = EXCLUDED.lon, geom = EXCLUDED.geom,
         sog = EXCLUDED.sog, cog = EXCLUDED.cog,
         -- Base stations / AtoNs don't report motion; keep last known values for those message types.
         heading = COALESCE(EXCLUDED.heading, CASE WHEN EXCLUDED.msg_type IN (4, 21) THEN cur.heading END),
         rot = EXCLUDED.rot, nav_status = COALESCE(EXCLUDED.nav_status, cur.nav_status),
         msg_type = EXCLUDED.msg_type, updated_at = now()
       WHERE EXCLUDED.ts > cur.ts
       RETURNING *
     )
     SELECT ${LEGACY_SHIP_COLUMNS}
     FROM up l JOIN vessels v USING (mmsi)`,
    [
      latest.map((p) => p.mmsi), latest.map((p) => p.ts), latest.map((p) => p.lat), latest.map((p) => p.lon),
      latest.map((p) => p.sog), latest.map((p) => p.cog), latest.map((p) => p.heading), latest.map((p) => p.rot),
      latest.map((p) => p.navStatus), latest.map((p) => p.msgType),
    ],
  );
  return rows;
}
