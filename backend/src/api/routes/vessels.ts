import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { LEGACY_SHIP_COLUMNS } from '../../db/legacy.js';
import { pool } from '../../db/pool.js';
import { readAccess } from '../auth/guard.js';
import { bboxParam, HttpError, mmsiParam, notFound, parse } from '../errors.js';

const listQuery = z.object({
  q: z.string().trim().min(1).max(64).optional(),
  bbox: bboxParam.optional(),
  limit: z.coerce.number().int().min(1).max(500).default(50),
});

const trackQuery = z.object({
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  /** Douglas-Peucker tolerance in degrees (e.g. 0.0005 ≈ 50 m). Times are omitted when simplifying. */
  tolerance: z.coerce.number().min(0).max(1).default(0),
  resolution: z.enum(['auto', 'raw', '1m']).default('auto'),
});

const RAW_MAX_MS = 6 * 3600_000;
const TRACK_MAX_MS = 31 * 86_400_000;

export async function vesselRoutes(app: FastifyInstance) {
  // Search by name (trigram), MMSI / IMO prefix, and/or bbox.
  app.get('/api/vessels', { preHandler: readAccess }, async (req) => {
    const q = parse(listQuery, req.query);
    const params: unknown[] = [];
    const where: string[] = [];
    let order = 'l.ts DESC NULLS LAST';
    if (q.q) {
      params.push(q.q);
      const i = params.length;
      where.push(`(v.name ILIKE '%' || $${i} || '%' OR v.mmsi::text LIKE $${i} || '%' OR v.imo::text LIKE $${i} || '%' OR v.callsign ILIKE $${i})`);
      order = `similarity(v.name, $${i}) DESC, ${order}`;
    }
    if (q.bbox) {
      params.push(...q.bbox);
      const n = params.length;
      where.push(`ST_Intersects(l.geom, ST_MakeEnvelope($${n - 3}, $${n - 2}, $${n - 1}, $${n}, 4326)::geography)`);
    }
    params.push(q.limit);
    const { rows } = await pool.query(
      `SELECT v.mmsi, v.uuid, v.name, v.imo, v.callsign, v.ship_type, v.ship_type_label, v.destination,
              l.lat::float8 AS latitude, l.lon::float8 AS longitude, round(l.sog::numeric, 1)::float8 AS sog, round(l.cog::numeric, 1)::float8 AS cog,
              (extract(epoch FROM l.ts) * 1000)::float8 AS last_report
       FROM vessels v LEFT JOIN vessel_latest l USING (mmsi)
       ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
       ORDER BY ${order}
       LIMIT $${params.length}`,
      params,
    );
    return rows;
  });

  // Full vessel profile: static data, latest position (legacy shape) and zones it is currently in.
  app.get('/api/vessels/:mmsi', { preHandler: readAccess }, async (req) => {
    const { mmsi } = parse(mmsiParam, req.params);
    const { rows } = await pool.query(
      `SELECT to_jsonb(v) - 'uuid' AS static, v.uuid::text AS uuid,
              (SELECT to_jsonb(x) FROM (SELECT ${LEGACY_SHIP_COLUMNS}, l.nav_status::int4 AS nav_status, l.rot::int4 AS rot
                                        FROM vessel_latest l WHERE l.mmsi = v.mmsi) x) AS latest,
              COALESCE((SELECT jsonb_agg(jsonb_build_object('id', z.id, 'name', z.name, 'kind', z.kind, 'entered_at', p.entered_at))
                        FROM zone_presence p JOIN zones z ON z.id = p.zone_id WHERE p.mmsi = v.mmsi), '[]'::jsonb) AS zones
       FROM vessels v WHERE v.mmsi = $1`,
      [mmsi],
    );
    if (!rows[0]) throw notFound('Vessel');
    return rows[0];
  });

  // Track history as a GeoJSON Feature (LineString). Raw points for <= 6h, 1-minute aggregate beyond.
  app.get('/api/vessels/:mmsi/track', { preHandler: readAccess }, async (req) => {
    const { mmsi } = parse(mmsiParam, req.params);
    const q = parse(trackQuery, req.query);
    const to = q.to ?? new Date();
    const from = q.from ?? new Date(to.getTime() - 24 * 3600_000);
    const span = to.getTime() - from.getTime();
    if (span <= 0) throw new HttpError(400, '`from` must be before `to`');
    if (span > TRACK_MAX_MS) throw new HttpError(400, 'Range too large (max 31 days)');

    const resolution = q.resolution === 'auto' ? (span <= RAW_MAX_MS ? 'raw' : '1m') : q.resolution;
    const source =
      resolution === 'raw'
        ? `SELECT ts, geom, sog FROM vessel_positions WHERE mmsi = $1 AND ts >= $2 AND ts <= $3`
        : // Materialized 1-minute buckets before the rollup watermark + the not-yet-rolled-up tail from raw data.
          `WITH wm AS (SELECT COALESCE((SELECT value FROM job_state WHERE name = 'tracks_1m'), '-infinity'::timestamptz) AS v)
           SELECT bucket AS ts, geom, sog_avg AS sog FROM vessel_tracks_1m, wm
           WHERE mmsi = $1 AND bucket >= $2 AND bucket <= $3 AND bucket < wm.v
           UNION ALL
           (SELECT DISTINCT ON (bucket) bucket, geom, avg(sog) OVER (PARTITION BY bucket)
            FROM (SELECT p.ts, p.geom, p.sog, date_bin(interval '1 minute', p.ts, timestamptz '2000-01-01') AS bucket
                  FROM vessel_positions p, wm
                  WHERE p.mmsi = $1 AND p.ts >= GREATEST($2, wm.v) AND p.ts <= $3) x
            ORDER BY bucket, ts DESC)`;

    const { rows } = await pool.query<{ geometry: unknown; times: number[] | null; points: number; max_sog: number | null }>(
      `WITH p AS (${source} ORDER BY ts),
       line AS (SELECT ST_MakeLine(geom::geometry ORDER BY ts) AS g FROM p)
       SELECT
         CASE WHEN (SELECT count(*) FROM p) = 0 THEN NULL
              WHEN (SELECT count(*) FROM p) = 1 THEN ST_AsGeoJSON((SELECT geom::geometry FROM p LIMIT 1), 6)::json
              ELSE ST_AsGeoJSON(CASE WHEN $4 > 0 THEN ST_SimplifyPreserveTopology(line.g, $4) ELSE line.g END, 6)::json
         END AS geometry,
         CASE WHEN $4 > 0 THEN NULL ELSE (SELECT array_agg((extract(epoch FROM ts) * 1000)::float8 ORDER BY ts) FROM p) END AS times,
         (SELECT count(*)::int FROM p) AS points,
         (SELECT round(max(sog)::numeric, 1)::float8 FROM p) AS max_sog
       FROM line`,
      [mmsi, from, to, q.tolerance],
    );
    const r = rows[0]!;
    return {
      type: 'Feature',
      geometry: r.geometry,
      properties: { mmsi, from: from.toISOString(), to: to.toISOString(), resolution, points: r.points, max_sog: r.max_sog, times: r.times },
    };
  });
}
