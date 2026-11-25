import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { audit } from '../../db/audit.js';
import { pool, withTransaction } from '../../db/pool.js';
import { readAccess, requireRole } from '../auth/guard.js';
import { notFound, parse, uuidParam } from '../errors.js';

const position = z.tuple([z.number().min(-180).max(180), z.number().min(-90).max(90)]).rest(z.number());
const ring = z.array(position).min(4);
const geometry = z.discriminatedUnion('type', [
  z.object({ type: z.literal('Polygon'), coordinates: z.array(ring).min(1) }),
  z.object({ type: z.literal('MultiPolygon'), coordinates: z.array(z.array(ring).min(1)).min(1) }),
]);
const rules = z
  .object({
    alert_on_enter: z.boolean().optional(),
    alert_on_exit: z.boolean().optional(),
    alert_on_gap: z.boolean().optional(),
    max_speed: z.number().positive().max(102).optional(),
    loiter_minutes: z.number().int().positive().max(7 * 24 * 60).optional(),
  })
  .strict();
const kind = z.enum(['restricted', 'monitoring', 'port', 'anchorage']);

const createBody = z.object({
  name: z.string().trim().min(1).max(120),
  kind: kind.default('monitoring'),
  geometry,
  rules: rules.default({}),
  active: z.boolean().default(true),
});
const patchBody = createBody.partial();

const ZONE_FEATURE = `
  jsonb_build_object(
    'type', 'Feature',
    'id', z.id,
    'geometry', ST_AsGeoJSON(z.geom, 6)::jsonb,
    'properties', jsonb_build_object(
      'id', z.id, 'name', z.name, 'kind', z.kind, 'rules', z.rules, 'active', z.active,
      'created_by', z.created_by, 'created_at', z.created_at, 'updated_at', z.updated_at,
      'vessels_inside', (SELECT count(*) FROM zone_presence p WHERE p.zone_id = z.id)
    )
  )`;

// Validates and normalises GeoJSON into a geography MultiPolygon; ST_MakeValid repairs self-intersections.
const GEOM_SQL = `ST_Multi(ST_CollectionExtract(ST_MakeValid(ST_SetSRID(ST_GeomFromGeoJSON($GEOM::text), 4326)), 3))::geography`;

export async function zoneRoutes(app: FastifyInstance) {
  app.get('/api/zones', { preHandler: readAccess }, async (req) => {
    const { active } = parse(z.object({ active: z.enum(['true', 'false']).optional() }), req.query);
    const { rows } = await pool.query(
      `SELECT ${ZONE_FEATURE} AS f FROM zones z ${active ? 'WHERE z.active = $1' : ''} ORDER BY z.created_at`,
      active ? [active === 'true'] : [],
    );
    return { type: 'FeatureCollection', features: rows.map((r) => r.f) };
  });

  app.get('/api/zones/:id', { preHandler: readAccess }, async (req) => {
    const { id } = parse(uuidParam, req.params);
    const { rows } = await pool.query(`SELECT ${ZONE_FEATURE} AS f FROM zones z WHERE z.id = $1`, [id]);
    if (!rows[0]) throw notFound('Zone');
    return rows[0].f;
  });

  // Vessels currently inside a zone.
  app.get('/api/zones/:id/vessels', { preHandler: readAccess }, async (req) => {
    const { id } = parse(uuidParam, req.params);
    const { rows } = await pool.query(
      `SELECT p.mmsi, v.name, v.ship_type_label, p.entered_at, p.last_seen_at, p.slow_since,
              l.lat::float8 AS latitude, l.lon::float8 AS longitude, round(l.sog::numeric, 1)::float8 AS sog
       FROM zone_presence p JOIN vessels v USING (mmsi) LEFT JOIN vessel_latest l USING (mmsi)
       WHERE p.zone_id = $1 ORDER BY p.entered_at DESC`,
      [id],
    );
    return rows;
  });

  app.post('/api/zones', { preHandler: requireRole('operator') }, async (req, reply) => {
    const b = parse(createBody, req.body);
    const zone = await withTransaction(async (c) => {
      const { rows } = await c.query(
        `WITH z AS (
           INSERT INTO zones (name, kind, geom, rules, active, created_by)
           VALUES ($1, $2, ${GEOM_SQL.replace('$GEOM', '$3')}, $4, $5, $6) RETURNING *
         ) SELECT ${ZONE_FEATURE} AS f FROM z`,
        [b.name, b.kind, JSON.stringify(b.geometry), b.rules, b.active, req.user!.id],
      );
      await audit(req.user!.id, 'zone.create', 'zone', rows[0].f.id, { name: b.name, kind: b.kind }, c);
      return rows[0].f;
    });
    return reply.status(201).send(zone);
  });

  app.patch('/api/zones/:id', { preHandler: requireRole('operator') }, async (req) => {
    const { id } = parse(uuidParam, req.params);
    const b = parse(patchBody, req.body);
    return withTransaction(async (c) => {
      const { rows } = await c.query(
        `WITH z AS (
           UPDATE zones SET
             name   = COALESCE($2, name),
             kind   = COALESCE($3::zone_kind, kind),
             geom   = CASE WHEN $4::text IS NULL THEN geom ELSE ${GEOM_SQL.replace('$GEOM', '$4')} END,
             rules  = COALESCE($5, rules),
             active = COALESCE($6, active),
             updated_at = now()
           WHERE id = $1 RETURNING *
         ) SELECT ${ZONE_FEATURE} AS f FROM z`,
        [id, b.name ?? null, b.kind ?? null, b.geometry ? JSON.stringify(b.geometry) : null, b.rules ?? null, b.active ?? null],
      );
      if (!rows[0]) throw notFound('Zone');
      // Geometry or activation changed: reset presence so it's recomputed from fresh positions without spurious alerts.
      if (b.geometry || b.active === false) await c.query(`DELETE FROM zone_presence WHERE zone_id = $1`, [id]);
      await audit(req.user!.id, 'zone.update', 'zone', id, { fields: Object.keys(b) }, c);
      return rows[0].f;
    });
  });

  app.delete('/api/zones/:id', { preHandler: requireRole('operator') }, async (req, reply) => {
    const { id } = parse(uuidParam, req.params);
    await withTransaction(async (c) => {
      const { rowCount } = await c.query(`DELETE FROM zones WHERE id = $1`, [id]);
      if (!rowCount) throw notFound('Zone');
      await audit(req.user!.id, 'zone.delete', 'zone', id, {}, c);
    });
    return reply.status(204).send();
  });
}
