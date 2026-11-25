import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { LEGACY_SHIP_COLUMNS } from '../../db/legacy.js';
import { pool } from '../../db/pool.js';
import { readAccess } from '../auth/guard.js';
import { bboxParam, bboxSql, HttpError, mmsiParam, notFound, parse } from '../errors.js';

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
  /** Accepted for backward compatibility; history is always returned at stored resolution. */
  resolution: z.enum(['auto', 'raw', '1m']).default('auto'),
});

const areaQuery = z.object({
  bbox: bboxParam,
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  limit: z.coerce.number().int().min(1).max(1000).default(200),
});

/** Compaction watermark: track points before it live in vessel_tracks, from it on in vessel_positions. */
const WATERMARK_CTE = `WITH wm AS (SELECT COALESCE((SELECT value FROM job_state WHERE name = 'tracks'), '-infinity'::timestamptz) AS v)`;

const TRACK_MAX_MS = 31 * 86_400_000;

export async function vesselRoutes(app: FastifyInstance) {
  // Search every known vessel: exact MMSI/IMO/callsign first, then name prefix, then fuzzy name, then recency.
  // Rows are in the legacy map shape (+ imo, callsign, destination, last_seen) so the UI can place them directly;
  // vessels without a known position have latitude/longitude = null.
  app.get('/api/vessels', { preHandler: readAccess }, async (req) => {
    const q = parse(listQuery, req.query);
    const params: unknown[] = [];
    const where: string[] = [];
    let order = 'l.ts DESC NULLS LAST';
    if (q.q) {
      const like = q.q.replace(/[\\%_]/g, (c) => '\\' + c); // escape LIKE wildcards
      params.push(q.q, like);
      const [t, k] = [`$${params.length - 1}`, `$${params.length}`];
      where.push(`(v.name ILIKE '%' || ${k} || '%'
                 OR v.callsign ILIKE ${k} || '%'
                 OR v.mmsi::text LIKE ${k} || '%'
                 OR (v.imo IS NOT NULL AND v.imo::text LIKE ${k} || '%'))`);
      order = `CASE WHEN v.mmsi::text = ${t} OR v.imo::text = ${t} OR upper(v.callsign) = upper(${t}) THEN 0
                    WHEN v.name ILIKE ${k} || '%' THEN 1
                    WHEN v.mmsi::text LIKE ${k} || '%' THEN 2
                    ELSE 3 END,
               word_similarity(${t}, v.name) DESC NULLS LAST, ${order}`;
    }
    if (q.bbox) {
      params.push(...q.bbox);
      where.push(bboxSql('l', params.length - 3));
    }
    params.push(q.limit);
    const { rows } = await pool.query(
      `SELECT ${LEGACY_SHIP_COLUMNS}, v.imo, v.callsign, v.destination,
              (extract(epoch FROM COALESCE(l.ts, v.last_seen)) * 1000)::float8 AS last_seen
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

  // Track history as a GeoJSON Feature (LineString): packed 6-hour blocks before the compaction
  // watermark + raw positions after it (disjoint by construction, so no duplicates).
  app.get('/api/vessels/:mmsi/track', { preHandler: readAccess }, async (req) => {
    const { mmsi } = parse(mmsiParam, req.params);
    const q = parse(trackQuery, req.query);
    const to = q.to ?? new Date();
    const from = q.from ?? new Date(to.getTime() - 24 * 3600_000);
    const span = to.getTime() - from.getTime();
    if (span <= 0) throw new HttpError(400, '`from` must be before `to`');
    if (span > TRACK_MAX_MS) throw new HttpError(400, 'Range too large (max 31 days)');

    const source = `
      SELECT tp.ts, tp.lat, tp.lon, tp.sog
      FROM vessel_tracks t, wm, track_points(t.pts, t.block_start) tp
      WHERE t.mmsi = $1 AND t.block_start > $2::timestamptz - interval '6 hours' AND t.block_start <= $3
        AND tp.ts >= $2 AND tp.ts <= $3 AND tp.ts < wm.v
      UNION ALL
      SELECT p.ts, ST_Y(p.geom::geometry), ST_X(p.geom::geometry), p.sog
      FROM vessel_positions p, wm
      WHERE p.mmsi = $1 AND p.ts >= GREATEST($2, wm.v) AND p.ts <= $3`;

    const { rows } = await pool.query<{ geometry: unknown; times: number[] | null; points: number; max_sog: number | null }>(
      `${WATERMARK_CTE},
       p AS (SELECT ts, ST_SetSRID(ST_MakePoint(lon, lat), 4326) AS geom, sog FROM (${source}) s ORDER BY ts),
       line AS (SELECT ST_MakeLine(geom ORDER BY ts) AS g FROM p)
       SELECT
         CASE WHEN (SELECT count(*) FROM p) = 0 THEN NULL
              WHEN (SELECT count(*) FROM p) = 1 THEN ST_AsGeoJSON((SELECT geom FROM p LIMIT 1), 6)::json
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
      properties: { mmsi, from: from.toISOString(), to: to.toISOString(), resolution: 'full', points: r.points, max_sog: r.max_sog, times: r.times },
    };
  });
  // Which vessels were inside this area during [from, to]? Block bounding boxes (GIST) narrow the
  // candidates, then individual points are checked. Default window: the last 6 hours.
  app.get('/api/tracks/area', { preHandler: readAccess }, async (req) => {
    const q = parse(areaQuery, req.query);
    const [minLon, minLat, maxLon, maxLat] = q.bbox;
    if (minLon > maxLon || minLat > maxLat) throw new HttpError(400, 'bbox must be minLon,minLat,maxLon,maxLat (no antimeridian crossing)');
    const to = q.to ?? new Date();
    const from = q.from ?? new Date(to.getTime() - 6 * 3600_000);
    if (to <= from) throw new HttpError(400, '`from` must be before `to`');
    if (to.getTime() - from.getTime() > TRACK_MAX_MS) throw new HttpError(400, 'Range too large (max 31 days)');

    const { rows } = await pool.query(
      `${WATERMARK_CTE},
       hits AS (
         SELECT t.mmsi, tp.ts
         FROM vessel_tracks t, wm, track_points(t.pts, t.block_start) tp
         WHERE box(point(t.min_lon, t.min_lat), point(t.max_lon, t.max_lat)) && box(point($1, $2), point($3, $4))
           AND t.block_start > $5::timestamptz - interval '6 hours' AND t.block_start <= $6
           AND tp.ts >= $5 AND tp.ts <= $6 AND tp.ts < wm.v
           AND tp.lon BETWEEN $1 AND $3 AND tp.lat BETWEEN $2 AND $4
         UNION ALL
         SELECT p.mmsi, p.ts
         FROM vessel_positions p, wm
         WHERE p.ts >= GREATEST($5, wm.v) AND p.ts <= $6
           AND ST_X(p.geom::geometry) BETWEEN $1 AND $3 AND ST_Y(p.geom::geometry) BETWEEN $2 AND $4
       )
       SELECT h.mmsi::int4 AS mmsi, v.uuid::text AS uuid, COALESCE(v.name, 'MMSI ' || h.mmsi) AS name,
              COALESCE(v.ship_type_label, 'Vessel') AS type,
              (extract(epoch FROM min(h.ts)) * 1000)::float8 AS first_seen,
              (extract(epoch FROM max(h.ts)) * 1000)::float8 AS last_seen,
              count(*)::int AS points
       FROM hits h JOIN vessels v USING (mmsi)
       GROUP BY h.mmsi, v.uuid, v.name, v.ship_type_label
       ORDER BY max(h.ts) DESC
       LIMIT $7`,
      [minLon, minLat, maxLon, maxLat, from, to, q.limit],
    );
    return { from: from.toISOString(), to: to.toISOString(), bbox: q.bbox, vessels: rows };
  });
}
