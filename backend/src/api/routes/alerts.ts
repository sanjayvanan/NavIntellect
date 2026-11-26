import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { audit } from '../../db/audit.js';
import { pool, withTransaction } from '../../db/pool.js';
import { readAccess, requireRole } from '../auth/guard.js';
import { notFound, parse, uuidParam } from '../errors.js';
import { viewerId, visibleSql } from '../auth/scope.js';

const ALERT_COLUMNS = `
  a.id, a.type, a.severity, a.mmsi, a.zone_id, z.name AS zone_name, v.name AS vessel_name,
  ST_Y(a.geom::geometry)::float8 AS latitude, ST_X(a.geom::geometry)::float8 AS longitude,
  a.details, a.created_at, a.acknowledged_at, a.acknowledged_by, u.email AS acknowledged_by_email`;
const ALERT_FROM = `
  alerts a LEFT JOIN zones z ON z.id = a.zone_id LEFT JOIN vessels v ON v.mmsi = a.mmsi
  LEFT JOIN users u ON u.id = a.acknowledged_by`;

const listQuery = z.object({
  status: z.enum(['open', 'acknowledged', 'all']).default('all'),
  type: z.enum(['zone_enter', 'zone_exit', 'loitering', 'speeding', 'ais_gap']).optional(),
  severity: z.enum(['info', 'warning', 'critical']).optional(),
  mmsi: z.coerce.number().int().positive().optional(),
  zone_id: z.uuid().optional(),
  since: z.coerce.date().optional(),
  /** Keyset pagination: pass the previous page's last created_at. */
  before: z.coerce.date().optional(),
  limit: z.coerce.number().int().min(1).max(500).default(100),
});

export async function alertRoutes(app: FastifyInstance) {
  app.get('/api/alerts', { preHandler: readAccess }, async (req) => {
    const q = parse(listQuery, req.query);
    // Alerts of other users' personal zones are invisible (alerts without a zone are always visible).
    const params: unknown[] = [viewerId(req)];
    const where: string[] = [`(z.id IS NULL OR ${visibleSql('z', 1)})`];
    const add = (sql: string, v: unknown) => {
      params.push(v);
      where.push(sql.replace('?', `$${params.length}`));
    };
    if (q.status === 'open') where.push('a.acknowledged_at IS NULL');
    if (q.status === 'acknowledged') where.push('a.acknowledged_at IS NOT NULL');
    if (q.type) add('a.type = ?', q.type);
    if (q.severity) add('a.severity = ?', q.severity);
    if (q.mmsi) add('a.mmsi = ?', q.mmsi);
    if (q.zone_id) add('a.zone_id = ?', q.zone_id);
    if (q.since) add('a.created_at >= ?', q.since);
    if (q.before) add('a.created_at < ?', q.before);
    params.push(q.limit);
    const { rows } = await pool.query(
      `SELECT ${ALERT_COLUMNS} FROM ${ALERT_FROM}
       ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
       ORDER BY a.created_at DESC LIMIT $${params.length}`,
      params,
    );
    return rows;
  });

  app.get('/api/alerts/summary', { preHandler: readAccess }, async (req) => {
    const { rows } = await pool.query(
      `SELECT a.type, a.severity, count(*)::int AS open
       FROM alerts a LEFT JOIN zones z ON z.id = a.zone_id
       WHERE a.acknowledged_at IS NULL AND (z.id IS NULL OR ${visibleSql('z', 1)})
       GROUP BY a.type, a.severity ORDER BY a.type, a.severity`,
      [viewerId(req)],
    );
    return rows;
  });

  // One alert (404 when it does not exist or belongs to another user's personal zone).
  app.get('/api/alerts/:id', { preHandler: readAccess }, async (req) => {
    const { id } = parse(uuidParam, req.params);
    const { rows } = await pool.query(
      `SELECT ${ALERT_COLUMNS}, z.kind::text AS zone_kind, z.rules AS zone_rules FROM ${ALERT_FROM}
       WHERE a.id = $1 AND (z.id IS NULL OR ${visibleSql('z', 2)})`,
      [id, viewerId(req)],
    );
    if (!rows[0]) throw notFound('Alert');
    return rows[0];
  });

  app.post('/api/alerts/:id/ack', { preHandler: requireRole('operator') }, async (req) => {
    const { id } = parse(uuidParam, req.params);
    const { note } = parse(z.object({ note: z.string().max(500).optional() }).default({}), req.body ?? {});
    return withTransaction(async (c) => {
      const { rows } = await c.query(
        `WITH a AS (
           UPDATE alerts SET acknowledged_at = COALESCE(acknowledged_at, now()),
                             acknowledged_by = COALESCE(acknowledged_by, $2)
           WHERE id = $1 RETURNING *
         ) SELECT ${ALERT_COLUMNS} FROM a LEFT JOIN zones z ON z.id = a.zone_id LEFT JOIN vessels v ON v.mmsi = a.mmsi
           LEFT JOIN users u ON u.id = a.acknowledged_by`,
        [id, req.user!.id],
      );
      if (!rows[0]) throw notFound('Alert');
      await audit(req.user!.id, 'alert.ack', 'alert', id, note ? { note } : {}, c);
      return rows[0];
    });
  });
}
