import type pg from 'pg';
import { withTransaction } from '../db/pool.js';
import type { PositionMsg } from '../ingest/types.js';

export type AlertType = 'zone_enter' | 'zone_exit' | 'loitering' | 'speeding' | 'ais_gap';
export type Severity = 'info' | 'warning' | 'critical';

export interface AlertRow {
  id: string;
  type: AlertType;
  severity: Severity;
  mmsi: number;
  zone_id: string | null;
  zone_name: string | null;
  vessel_name: string | null;
  latitude: number | null;
  longitude: number | null;
  details: Record<string, unknown>;
  created_at: string;
}

interface Candidate {
  type: AlertType;
  zone_id: string;
  zone_kind: string;
  mmsi: number;
  lat: number | null;
  lon: number | null;
  details: Record<string, unknown>;
}

const LOITER_SOG_KN = 0.5;

function severityFor(type: AlertType, zoneKind: string): Severity {
  const restricted = zoneKind === 'restricted';
  switch (type) {
    case 'zone_enter': return restricted ? 'critical' : 'info';
    case 'zone_exit': return 'info';
    case 'loitering': return restricted ? 'critical' : 'warning';
    case 'speeding': return 'warning';
    case 'ais_gap': return restricted ? 'critical' : 'warning';
  }
}

/**
 * Evaluates geofence rules for the vessels whose latest position advanced in a batch.
 * All set-based: one statement computes enter/exit/speeding and updates presence,
 * a second detects loitering. Runs in its own transaction after the position write commits.
 */
export async function evaluateZones(latest: PositionMsg[], cooldownMinutes: number): Promise<AlertRow[]> {
  if (latest.length === 0) return [];
  const args = [
    latest.map((p) => p.mmsi), latest.map((p) => p.lat), latest.map((p) => p.lon),
    latest.map((p) => p.sog), latest.map((p) => p.ts),
  ];

  return withTransaction(async (client) => {
    // Skip the work entirely when no zone is active (common on a fresh install).
    const { rows: zc } = await client.query<{ n: number }>(`SELECT count(*)::int AS n FROM zones WHERE active`);
    const hasPresence = await client.query(`SELECT 1 FROM zone_presence WHERE mmsi = ANY($1::int4[]) LIMIT 1`, [args[0]]);
    if (zc[0]!.n === 0 && hasPresence.rowCount === 0) return [];

    const { rows: transitions } = await client.query<Candidate>(
      `WITH b AS (
         SELECT * FROM unnest($1::int4[], $2::float8[], $3::float8[], $4::real[], $5::timestamptz[])
           AS t(mmsi, lat, lon, sog, ts)
       ),
       inside AS (
         SELECT z.id AS zone_id, z.kind::text AS zone_kind, z.rules, b.*
         FROM b JOIN zones z
           ON z.active AND ST_Covers(z.geom, ST_SetSRID(ST_MakePoint(b.lon, b.lat), 4326)::geography)
       ),
       prev AS (
         SELECT p.zone_id, p.mmsi FROM zone_presence p WHERE p.mmsi = ANY($1::int4[])
       ),
       entered AS (
         SELECT i.* FROM inside i
         WHERE NOT EXISTS (SELECT 1 FROM prev p WHERE p.zone_id = i.zone_id AND p.mmsi = i.mmsi)
       ),
       exited AS (
         SELECT p.zone_id, z.kind::text AS zone_kind, z.rules, b.*
         FROM prev p JOIN b ON b.mmsi = p.mmsi JOIN zones z ON z.id = p.zone_id AND z.active
         WHERE NOT EXISTS (SELECT 1 FROM inside i WHERE i.zone_id = p.zone_id AND i.mmsi = p.mmsi)
       ),
       del AS (
         DELETE FROM zone_presence p USING exited e
         WHERE p.zone_id = e.zone_id AND p.mmsi = e.mmsi
       ),
       ups AS (
         INSERT INTO zone_presence AS zp (zone_id, mmsi, entered_at, last_seen_at, slow_since)
         SELECT zone_id, mmsi, ts, ts, CASE WHEN sog < ${LOITER_SOG_KN} THEN ts END FROM inside
         ON CONFLICT (zone_id, mmsi) DO UPDATE SET
           last_seen_at   = GREATEST(zp.last_seen_at, EXCLUDED.last_seen_at),
           slow_since     = CASE WHEN EXCLUDED.slow_since IS NULL THEN NULL
                                 ELSE COALESCE(zp.slow_since, EXCLUDED.slow_since) END,
           loiter_alerted = CASE WHEN EXCLUDED.slow_since IS NULL THEN false ELSE zp.loiter_alerted END,
           gap_alerted    = false
       )
       SELECT 'zone_enter' AS type, zone_id, zone_kind, mmsi, lat, lon,
              jsonb_build_object('sog', sog, 'ts', ts) AS details
       FROM entered WHERE COALESCE((rules->>'alert_on_enter')::boolean, true)
       UNION ALL
       SELECT 'zone_exit', zone_id, zone_kind, mmsi, lat, lon, jsonb_build_object('sog', sog, 'ts', ts)
       FROM exited WHERE COALESCE((rules->>'alert_on_exit')::boolean, true)
       UNION ALL
       SELECT 'speeding', zone_id, zone_kind, mmsi, lat, lon,
              jsonb_build_object('sog', sog, 'max_speed', (rules->>'max_speed')::real, 'ts', ts)
       FROM inside WHERE rules ? 'max_speed' AND sog > (rules->>'max_speed')::real`,
      args,
    );

    const { rows: loiter } = await client.query<Candidate>(
      `UPDATE zone_presence p SET loiter_alerted = true
       FROM zones z, vessel_latest l
       WHERE p.zone_id = z.id AND l.mmsi = p.mmsi
         AND p.mmsi = ANY($1::int4[])
         AND z.active AND z.rules ? 'loiter_minutes'
         AND NOT p.loiter_alerted AND p.slow_since IS NOT NULL
         AND p.last_seen_at - p.slow_since >= make_interval(mins => (z.rules->>'loiter_minutes')::int)
       RETURNING 'loitering' AS type, p.zone_id, z.kind::text AS zone_kind, p.mmsi, l.lat, l.lon,
                 jsonb_build_object('slow_since', p.slow_since, 'loiter_minutes', (z.rules->>'loiter_minutes')::int) AS details`,
      [args[0]],
    );

    return insertAlerts(client, [...transitions, ...loiter], cooldownMinutes);
  });
}

/** Vessels inside a zone that stopped reporting: likely AIS switched off. */
export async function sweepAisGaps(gapMinutes: number, cooldownMinutes: number): Promise<AlertRow[]> {
  return withTransaction(async (client) => {
    const { rows } = await client.query<Candidate>(
      `UPDATE zone_presence p SET gap_alerted = true
       FROM zones z, vessel_latest l
       WHERE p.zone_id = z.id AND l.mmsi = p.mmsi AND z.active
         AND NOT p.gap_alerted
         AND COALESCE((z.rules->>'alert_on_gap')::boolean, true)
         AND l.ts < now() - make_interval(mins => $1::int)
       RETURNING 'ais_gap' AS type, p.zone_id, z.kind::text AS zone_kind, p.mmsi, l.lat, l.lon,
                 jsonb_build_object('last_report', l.ts, 'gap_minutes', $1::int) AS details`,
      [Math.round(gapMinutes)],
    );
    return insertAlerts(client, rows, cooldownMinutes);
  });
}

async function insertAlerts(
  client: pg.PoolClient,
  candidates: Candidate[],
  cooldownMinutes: number,
): Promise<AlertRow[]> {
  if (candidates.length === 0) return [];
  const { rows } = await client.query<AlertRow>(
    `WITH c AS (
       SELECT * FROM unnest($1::alert_type[], $2::alert_severity[], $3::int4[], $4::uuid[],
                            $5::float8[], $6::float8[], $7::jsonb[])
         AS t(type, severity, mmsi, zone_id, lat, lon, details)
     ),
     ins AS (
       INSERT INTO alerts (type, severity, mmsi, zone_id, geom, details)
       SELECT c.type, c.severity, c.mmsi, c.zone_id,
              CASE WHEN c.lat IS NOT NULL THEN ST_SetSRID(ST_MakePoint(c.lon, c.lat), 4326)::geography END,
              c.details
       FROM c
       WHERE NOT EXISTS (
         SELECT 1 FROM alerts a
         WHERE a.type = c.type AND a.mmsi = c.mmsi AND a.zone_id IS NOT DISTINCT FROM c.zone_id
           AND a.created_at > now() - make_interval(mins => $8::int)
       )
       RETURNING *
     )
     SELECT ins.id, ins.type, ins.severity, ins.mmsi, ins.zone_id, z.name AS zone_name, v.name AS vessel_name,
            ST_Y(ins.geom::geometry)::float8 AS latitude, ST_X(ins.geom::geometry)::float8 AS longitude,
            ins.details, ins.created_at
     FROM ins LEFT JOIN zones z ON z.id = ins.zone_id LEFT JOIN vessels v ON v.mmsi = ins.mmsi`,
    [
      candidates.map((c) => c.type),
      candidates.map((c) => severityFor(c.type, c.zone_kind)),
      candidates.map((c) => c.mmsi),
      candidates.map((c) => c.zone_id),
      candidates.map((c) => c.lat),
      candidates.map((c) => c.lon),
      candidates.map((c) => JSON.stringify(c.details)),
      Math.round(cooldownMinutes),
    ],
  );
  return rows;
}

