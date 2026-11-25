import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { LEGACY_SHIP_COLUMNS } from '../../db/legacy.js';
import { pool } from '../../db/pool.js';
import type { LegacyShip } from '../../ingest/types.js';
import { readAccess } from '../auth/guard.js';
import { bboxParam, parse } from '../errors.js';

const query = z.object({
  hours: z.coerce.number().positive().max(720).default(24),
  bbox: bboxParam.optional(),
});

/** Legacy contract used by the existing frontend (src/store/shipSlice.js). Flat array, no envelope. */
export async function shipRoutes(app: FastifyInstance) {
  app.get('/api/ships/trackList', { preHandler: readAccess }, async (req) => {
    const q = parse(query, req.query);
    const params: unknown[] = [q.hours];
    let where = `l.ts >= now() - make_interval(secs => $1 * 3600)`;
    if (q.bbox) {
      params.push(...q.bbox);
      where += ` AND ST_Intersects(l.geom, ST_MakeEnvelope($2, $3, $4, $5, 4326)::geography)`;
    }
    const { rows } = await pool.query<LegacyShip>(
      `SELECT ${LEGACY_SHIP_COLUMNS} FROM vessel_latest l JOIN vessels v USING (mmsi) WHERE ${where}`,
      params,
    );
    return rows;
  });
}
