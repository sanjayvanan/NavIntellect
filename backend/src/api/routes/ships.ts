import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { LEGACY_SHIP_COLUMNS } from '../../db/legacy.js';
import { pool } from '../../db/pool.js';
import type { LegacyShip } from '../../ingest/types.js';
import { readAccess } from '../auth/guard.js';
import { bboxParam, bboxSql, parse } from '../errors.js';
import { cellDegrees, FULL_DETAIL_ZOOM, type ShipCache } from '../shipCache.js';

const query = z.object({
  hours: z.coerce.number().positive().max(720).default(24),
  bbox: bboxParam.optional(),
  /** Optional cap (most recently heard ships first); omitted = everything, as before. */
  limit: z.coerce.number().int().min(1).max(20000).optional(),
  /**
   * Map zoom level for level-of-detail: below FULL_DETAIL_ZOOM only one representative ship per
   * grid cell (~32 px on screen) is returned, so a world view shows a few hundred well-spread
   * ships instead of 50k. Omitted = no thinning.
   */
  zoom: z.coerce.number().min(0).max(24).optional(),
});

/** Legacy contract used by the existing frontend (src/store/shipSlice.js). Flat array, no envelope. */
export async function shipRoutes(app: FastifyInstance, opts: { cache?: ShipCache }) {
  app.get('/api/ships/trackList', { preHandler: readAccess }, async (req) => {
    const q = parse(query, req.query);
    // Map requests (with zoom) are answered from memory: no DB round trip while panning.
    if (q.zoom !== undefined && opts.cache?.ready) return opts.cache.query(q);

    const params: unknown[] = [q.hours];
    let where = `l.ts >= now() - make_interval(secs => $1 * 3600)`;
    if (q.bbox) {
      params.push(...q.bbox);
      where += ` AND ${bboxSql('l', 2)}`;
    }
    // Pick the ships on vessel_latest alone, then build the response columns only for those.
    let pick: string;
    if (q.zoom !== undefined && q.zoom < FULL_DETAIL_ZOOM) {
      // One ship per grid cell: prefer recently heard, then moving, then newest.
      params.push(cellDegrees(q.zoom));
      const c = `$${params.length}::float8`;
      pick = `SELECT * FROM (
                SELECT DISTINCT ON (floor(l.lon / ${c}), floor(l.lat / ${c})) l.mmsi, l.ts
                FROM vessel_latest l WHERE ${where}
                ORDER BY floor(l.lon / ${c}), floor(l.lat / ${c}),
                         (l.ts > now() - interval '30 minutes') DESC, (COALESCE(l.sog, 0) >= 1) DESC, l.ts DESC
              ) cells`;
    } else {
      pick = `SELECT l.mmsi, l.ts FROM vessel_latest l WHERE ${where}`;
    }
    if (q.limit) {
      params.push(q.limit);
      pick = `SELECT * FROM (${pick}) p ORDER BY ts DESC LIMIT $${params.length}`;
    }
    const { rows } = await pool.query<LegacyShip>(
      `SELECT ${LEGACY_SHIP_COLUMNS}
       FROM (${pick}) s JOIN vessel_latest l USING (mmsi) JOIN vessels v USING (mmsi)`,
      params,
    );
    return rows;
  });
}
