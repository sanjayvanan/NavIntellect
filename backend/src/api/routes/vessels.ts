import { M_PER_DEG, optimizeTrack, type TrackPoint } from '../../shared/simplify.js';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { LEGACY_SHIP_COLUMNS } from '../../db/legacy.js';
import { pool } from '../../db/pool.js';
import { readAccess } from '../auth/guard.js';
import { bboxParam, bboxSql, HttpError, mmsiParam, notFound, parse } from '../errors.js';
import { visibleSql } from '../auth/scope.js';

const listQuery = z.object({
  q: z.string().trim().min(1).max(64).optional(),
  bbox: bboxParam.optional(),
  limit: z.coerce.number().int().min(1).max(500).default(50),
});

/** Ship list (Track info panel): every ship heard recently, optionally only those inside a zone. */
const browseQuery = z.object({
  q: z.string().trim().min(1).max(64).optional(),
  /** Only ships whose latest position is inside this zone (one the viewer can see). */
  zone_id: z.uuid().optional(),
  /** Heard within this many hours; the map shows the last 50 h, so the default matches it. */
  hours: z.coerce.number().positive().max(720).default(50),
  /** Only ships inside this box (minLon,minLat,maxLon,maxLat). */
  bbox: bboxParam.optional(),
  /** Speed over ground range, knots. */
  min_sog: z.coerce.number().min(0).max(100).optional(),
  max_sog: z.coerce.number().min(0).max(100).optional(),
  /** Ship type label contains this, e.g. "tanker", "cargo", "fishing". */
  type: z.string().trim().min(2).max(40).optional(),
  sort: z.enum(['recent', 'name', 'speed']).default('recent'),
  offset: z.coerce.number().int().min(0).max(100_000).default(0),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

/**
 * The search used by both the search box and the ship list: matches name (anywhere), callsign,
 * MMSI and IMO (prefix). Adds its parameters to `params`; returns the WHERE clause and the
 * relevance ORDER BY (exact MMSI/IMO/callsign, then name prefix, then MMSI prefix, then fuzzy name).
 */
function searchSql(text: string, params: unknown[]) {
  const like = text.replace(/[\\%_]/g, (c) => '\\' + c); // escape LIKE wildcards
  params.push(text, like);
  const [t, k] = [`$${params.length - 1}`, `$${params.length}`];
  return {
    where: `(v.name ILIKE '%' || ${k} || '%'
             OR v.callsign ILIKE ${k} || '%'
             OR v.mmsi::text LIKE ${k} || '%'
             OR (v.imo IS NOT NULL AND v.imo::text LIKE ${k} || '%'))`,
    order: `CASE WHEN v.mmsi::text = ${t} OR v.imo::text = ${t} OR upper(v.callsign) = upper(${t}) THEN 0
                 WHEN v.name ILIKE ${k} || '%' THEN 1
                 WHEN v.mmsi::text LIKE ${k} || '%' THEN 2
                 ELSE 3 END,
            word_similarity(${t}, v.name) DESC NULLS LAST`,
  };
}

const trackQuery = z.object({
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  /**
   * Douglas–Peucker tolerance in degrees (0.0004 ≈ 44 m; measured on the ground at any latitude);
   * 0 = every stored position. Kept points keep their times; gaps in reception are in `breaks`.
   */
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
      const search = searchSql(q.q, params);
      where.push(search.where);
      order = `${search.order}, ${order}`;
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

  // Ship list for the Track info panel: { total, vessels } where total counts every match and
  // vessels is one page (offset/limit) in the legacy map shape (+ imo, callsign, destination).
  app.get('/api/vessels/browse', { preHandler: readAccess }, async (req) => {
    const q = parse(browseQuery, req.query);
    const params: unknown[] = [q.hours];
    const where = ['l.ts >= now() - make_interval(secs => $1::float8 * 3600)'];
    let zoneJoin = '';
    let zone: { id: string; name: string } | null = null;
    if (q.zone_id) {
      const { rows } = await pool.query(`SELECT z.id, z.name FROM zones z WHERE z.id = $1 AND ${visibleSql('z', 2)}`, [
        q.zone_id,
        req.user?.id ?? null,
      ]);
      if (!rows[0]) throw notFound('Zone');
      zone = rows[0];
      params.push(q.zone_id);
      zoneJoin = `JOIN zones z ON z.id = $${params.length} AND ST_Covers(z.geom, l.geom)`;
    }
    if (q.bbox) {
      params.push(...q.bbox);
      where.push(bboxSql('l', params.length - 3));
    }
    if (q.min_sog !== undefined) {
      params.push(q.min_sog);
      where.push(`l.sog >= $${params.length}`);
    }
    if (q.max_sog !== undefined) {
      params.push(q.max_sog);
      where.push(`l.sog <= $${params.length}`);
    }
    if (q.type) {
      params.push(q.type.replace(/[\\%_]/g, (c) => '\\' + c));
      where.push(`v.ship_type_label ILIKE '%' || $${params.length} || '%'`);
    }
    const orders = {
      recent: 'l.ts DESC',
      name: 'v.name ASC NULLS LAST, v.mmsi',
      speed: 'l.sog DESC NULLS LAST, l.ts DESC',
    };
    let order: string = orders[q.sort];
    if (q.q) {
      const search = searchSql(q.q, params);
      where.push(search.where);
      // "Recently heard" puts the best matches first; other orders use relevance to break ties.
      order = q.sort === 'recent' ? `${search.order}, ${order}` : `${order}, ${search.order}`;
    }
    params.push(q.limit, q.offset);
    const { rows } = await pool.query(
      `WITH m AS MATERIALIZED (
         SELECT l.mmsi FROM vessel_latest l JOIN vessels v USING (mmsi) ${zoneJoin}
         WHERE ${where.join(' AND ')}
       ),
       page AS (
         SELECT ${LEGACY_SHIP_COLUMNS}, v.imo, v.callsign, v.destination,
                row_number() OVER (ORDER BY ${order}, v.mmsi) AS _rn
         FROM m JOIN vessel_latest l USING (mmsi) JOIN vessels v USING (mmsi)
         ORDER BY _rn
         LIMIT $${params.length - 1} OFFSET $${params.length}
       )
       SELECT (SELECT count(*) FROM m)::int AS total,
              COALESCE((SELECT jsonb_agg(to_jsonb(page) - '_rn' ORDER BY _rn) FROM page), '[]'::jsonb) AS vessels`,
      params,
    );
    return { total: rows[0].total, offset: q.offset, limit: q.limit, zone, vessels: rows[0].vessels };
  });

  // Full vessel profile: static data, latest position (legacy shape) and zones it is currently in.
  app.get('/api/vessels/:mmsi', { preHandler: readAccess }, async (req) => {
    const { mmsi } = parse(mmsiParam, req.params);
    const { rows } = await pool.query(
      `SELECT to_jsonb(v) - 'uuid' AS static, v.uuid::text AS uuid,
              (SELECT to_jsonb(x) FROM (SELECT ${LEGACY_SHIP_COLUMNS}, l.nav_status::int4 AS nav_status, l.rot::int4 AS rot
                                        FROM vessel_latest l WHERE l.mmsi = v.mmsi) x) AS latest,
              COALESCE((SELECT jsonb_agg(jsonb_build_object('id', z.id, 'name', z.name, 'kind', z.kind, 'entered_at', p.entered_at))
                        FROM zone_presence p JOIN zones z ON z.id = p.zone_id
                        WHERE p.mmsi = v.mmsi AND ${visibleSql('z', 2)}), '[]'::jsonb) AS zones
       FROM vessels v WHERE v.mmsi = $1`,
      [mmsi, req.user?.id ?? null],
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

    const { rows } = await pool.query<{ ts: number; lat: number; lon: number; sog: number | null }>(
      `${WATERMARK_CTE}
       SELECT (extract(epoch FROM ts) * 1000)::float8 AS ts, lat, lon, sog FROM (${source}) s ORDER BY ts`,
      [mmsi, from, to],
    );
    const raw: TrackPoint[] = rows;
    // Douglas–Peucker: tolerance in degrees as before (0.0004 ≈ 44 m), measured in metres on the
    // ground. Gaps in reception are kept and listed in `breaks` (see shared/simplify.ts).
    const { points, breaks } = q.tolerance > 0 ? optimizeTrack(raw, q.tolerance * M_PER_DEG) : { points: raw, breaks: null };
    const coord = (p: TrackPoint) => [Math.round(p.lon * 1e6) / 1e6, Math.round(p.lat * 1e6) / 1e6];
    const sogs = raw.map((p) => p.sog).filter((v): v is number => v != null);
    return {
      type: 'Feature',
      geometry:
        points.length === 0 ? null
        : points.length === 1 ? { type: 'Point', coordinates: coord(points[0]!) }
        : { type: 'LineString', coordinates: points.map(coord) },
      properties: {
        mmsi,
        from: from.toISOString(),
        to: to.toISOString(),
        resolution: q.tolerance > 0 ? 'simplified' : 'full',
        points: raw.length, // positions in the period (before simplifying)
        returned: points.length,
        tolerance: q.tolerance,
        max_sog: sogs.length ? Math.round(sogs.reduce((m, v) => (v > m ? v : m), -Infinity) * 10) / 10 : null,
        times: points.map((p) => p.ts),
        ...(breaks ? { breaks } : {}),
      },
    };
  });
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
