import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { audit } from '../../db/audit.js';
import { pool, withTransaction } from '../../db/pool.js';
import { readAccess, requireRole } from '../auth/guard.js';
import { assertEditable, enforcePersonalCap, ownerFor, scopeSql, viewerId, visibleSql } from '../auth/scope.js';
import { notFound, parse, uuidParam } from '../errors.js';

/**
 * Geofences, in the shared/personal ownership scopes of ../auth/scope.ts (presets are shared).
 */

export const MAX_PERSONAL_ZONES = 200;
const MAX_VERTICES = 5000;

const position = z.tuple([z.number().min(-180).max(180), z.number().min(-90).max(90)]).rest(z.number());
const ring = z.array(position).min(4).max(MAX_VERTICES);
const geometry = z
  .discriminatedUnion('type', [
    z.object({ type: z.literal('Polygon'), coordinates: z.array(ring).min(1).max(20) }),
    z.object({ type: z.literal('MultiPolygon'), coordinates: z.array(z.array(ring).min(1).max(20)).min(1).max(50) }),
  ])
  .refine(
    (g) => (g.type === 'Polygon' ? [g.coordinates] : g.coordinates).flat().reduce((n, r) => n + r.length, 0) <= MAX_VERTICES,
    { message: `At most ${MAX_VERTICES} vertices per zone` },
  );
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
const color = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Colour must be #rrggbb');

const createBody = z.object({
  name: z.string().trim().min(1).max(120),
  kind: kind.default('monitoring'),
  geometry,
  rules: rules.default({}),
  active: z.boolean().default(false), // monitoring (alerts) off until switched on
  scope: z.enum(['personal', 'shared']).default('personal'),
  color: color.nullish(),
  description: z.string().trim().max(500).nullish(),
});
const patchBody = createBody.omit({ scope: true }).partial();

const ZONE_FEATURE = `
  jsonb_build_object(
    'type', 'Feature',
    'id', z.id,
    'geometry', ST_AsGeoJSON(z.geom, 6)::jsonb,
    'properties', jsonb_build_object(
      'id', z.id, 'name', z.name, 'kind', z.kind, 'rules', z.rules, 'active', z.active,
      'scope', ${scopeSql('z')},
      'owner_id', z.owner_id, 'color', z.color, 'description', z.description, 'preset', z.preset,
      'area_nm2', round((ST_Area(z.geom) / 3429904)::numeric, 2),
      'perimeter_nm', round((ST_Perimeter(z.geom) / 1852)::numeric, 2),
      'created_by', z.created_by, 'created_at', z.created_at, 'updated_at', z.updated_at,
      'vessels_inside', (SELECT count(*) FROM zone_presence p WHERE p.zone_id = z.id)
    )
  )`;

// Validates and normalises GeoJSON into a geography MultiPolygon; ST_MakeValid repairs self-intersections.
const GEOM_SQL = `ST_Multi(ST_CollectionExtract(ST_MakeValid(ST_SetSRID(ST_GeomFromGeoJSON($GEOM::text), 4326)), 3))::geography`;

export async function zoneRoutes(app: FastifyInstance) {
  app.get('/api/zones', { preHandler: readAccess }, async (req) => {
    const q = parse(
      z.object({ active: z.enum(['true', 'false']).optional(), scope: z.enum(['personal', 'shared']).optional() }),
      req.query,
    );
    const params: unknown[] = [viewerId(req)];
    const where = [visibleSql('z', 1)];
    if (q.active) {
      params.push(q.active === 'true');
      where.push(`z.active = $${params.length}`);
    }
    if (q.scope) where.push(q.scope === 'shared' ? 'z.owner_id IS NULL' : 'z.owner_id = $1::uuid');
    const { rows } = await pool.query(
      `SELECT ${ZONE_FEATURE} AS f FROM zones z WHERE ${where.join(' AND ')}
       ORDER BY z.owner_id IS NULL, z.preset, z.created_at`,
      params,
    );
    return { type: 'FeatureCollection', features: rows.map((r) => r.f) };
  });

  app.get('/api/zones/:id', { preHandler: readAccess }, async (req) => {
    const { id } = parse(uuidParam, req.params);
    const { rows } = await pool.query(
      `SELECT ${ZONE_FEATURE} AS f FROM zones z WHERE z.id = $1 AND ${visibleSql('z', 2)}`,
      [id, viewerId(req)],
    );
    if (!rows[0]) throw notFound('Zone');
    return rows[0].f;
  });

  /**
   * Vessels inside a zone right now, from their latest positions (works whether or not monitoring
   * is on). Busy straits hold thousands of ships: `total` is the full count, `vessels` the newest `limit`.
   */
  app.get('/api/zones/:id/vessels', { preHandler: readAccess }, async (req) => {
    const { id } = parse(uuidParam, req.params);
    const { limit, hours } = parse(
      z.object({
        limit: z.coerce.number().int().min(1).max(1000).default(200),
        hours: z.coerce.number().min(0.1).max(72).default(6),
      }),
      req.query,
    );
    const { rows } = await pool.query(
      `WITH zz AS (SELECT id, geom FROM zones z WHERE z.id = $1 AND ${visibleSql('z', 2)}),
       inside AS (
         SELECT l.mmsi, l.ts, l.lat, l.lon, l.sog
         FROM zz JOIN vessel_latest l ON ST_Covers(zz.geom, l.geom)
         WHERE l.ts > now() - make_interval(secs => $3::float8 * 3600)
       )
       SELECT (SELECT count(*) FROM zz)::int AS found,
              (SELECT count(*) FROM inside)::int AS total,
              COALESCE((SELECT jsonb_agg(x) FROM (
                SELECT i.mmsi, v.name, v.ship_type_label, p.entered_at, i.ts AS last_seen_at, p.slow_since,
                       i.lat AS latitude, i.lon AS longitude, round(i.sog::numeric, 1)::float8 AS sog
                FROM inside i JOIN vessels v USING (mmsi)
                LEFT JOIN zone_presence p ON p.zone_id = $1 AND p.mmsi = i.mmsi
                ORDER BY i.ts DESC LIMIT $4) x), '[]'::jsonb) AS vessels`,
      [id, viewerId(req), hours, limit],
    );
    if (!rows[0].found) throw notFound('Zone');
    return { total: rows[0].total, vessels: rows[0].vessels };
  });

  app.post('/api/zones', { preHandler: requireRole('viewer') }, async (req, reply) => {
    const b = parse(createBody, req.body);
    const user = req.user!;
    const ownerId = ownerFor(b.scope, user, 'zones');
    const zone = await withTransaction(async (c) => {
      if (ownerId) await enforcePersonalCap(c, 'zones', ownerId, MAX_PERSONAL_ZONES, 'zones');
      const { rows } = await c.query(
        `WITH z AS (
           INSERT INTO zones (name, kind, geom, rules, active, created_by, owner_id, color, description)
           VALUES ($1, $2, ${GEOM_SQL.replace('$GEOM', '$3')}, $4, $5, $6, $7, $8, $9) RETURNING *
         ) SELECT ${ZONE_FEATURE} AS f FROM z`,
        [b.name, b.kind, JSON.stringify(b.geometry), b.rules, b.active, user.id, ownerId, b.color ?? null, b.description ?? null],
      );
      await audit(user.id, 'zone.create', 'zone', rows[0].f.id, { name: b.name, kind: b.kind, scope: b.scope }, c);
      return rows[0].f;
    });
    return reply.status(201).send(zone);
  });

  app.patch('/api/zones/:id', { preHandler: requireRole('viewer') }, async (req) => {
    const { id } = parse(uuidParam, req.params);
    const b = parse(patchBody, req.body);
    return withTransaction(async (c) => {
      await assertEditable(c, 'zones', id, req.user!, 'Zone');
      const { rows } = await c.query(
        `WITH z AS (
           UPDATE zones SET
             name   = COALESCE($2, name),
             kind   = COALESCE($3::zone_kind, kind),
             geom   = CASE WHEN $4::text IS NULL THEN geom ELSE ${GEOM_SQL.replace('$GEOM', '$4')} END,
             rules  = COALESCE($5, rules),
             active = COALESCE($6, active),
             color  = CASE WHEN $7::boolean THEN $8 ELSE color END,
             description = CASE WHEN $9::boolean THEN $10 ELSE description END,
             updated_at = now()
           WHERE id = $1 RETURNING *
         ) SELECT ${ZONE_FEATURE} AS f FROM z`,
        [
          id, b.name ?? null, b.kind ?? null, b.geometry ? JSON.stringify(b.geometry) : null, b.rules ?? null, b.active ?? null,
          b.color !== undefined, b.color ?? null, b.description !== undefined, b.description ?? null,
        ],
      );
      // Geometry or activation changed: reset presence so it's recomputed from fresh positions without spurious alerts.
      if (b.geometry || b.active === false) await c.query(`DELETE FROM zone_presence WHERE zone_id = $1`, [id]);
      await audit(req.user!.id, 'zone.update', 'zone', id, { fields: Object.keys(b) }, c);
      return rows[0].f;
    });
  });

  app.delete('/api/zones/:id', { preHandler: requireRole('viewer') }, async (req, reply) => {
    const { id } = parse(uuidParam, req.params);
    await withTransaction(async (c) => {
      await assertEditable(c, 'zones', id, req.user!, 'Zone');
      await c.query(`DELETE FROM zones WHERE id = $1`, [id]);
      await audit(req.user!.id, 'zone.delete', 'zone', id, {}, c);
    });
    return reply.status(204).send();
  });
}
