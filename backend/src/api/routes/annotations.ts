import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { ANNOTATION_KINDS, kindSchema, type AnnotationKind } from '../annotations/kinds.js';
import { audit } from '../../db/audit.js';
import { pool, withTransaction } from '../../db/pool.js';
import { readAccess, requireRole } from '../auth/guard.js';
import { assertEditable, enforcePersonalCap, ownerFor, scopeSql, viewerId, visibleSql } from '../auth/scope.js';
import { bboxParam, notFound, parse, uuidParam } from '../errors.js';

/**
 * Map annotations (pins, …) in the shared/personal scopes of ../auth/scope.ts.
 * The kind registry (../annotations/kinds.ts) validates geometry and style per kind.
 */

export const MAX_PERSONAL_ANNOTATIONS = 1000;

const FEATURE = `
  jsonb_build_object(
    'type', 'Feature',
    'id', a.id,
    'geometry', ST_AsGeoJSON(a.geom, 6)::jsonb,
    'properties', jsonb_build_object(
      'id', a.id, 'kind', a.kind, 'name', a.name, 'description', a.description,
      'style', a.style, 'properties', a.properties, 'scope', ${scopeSql('a')}, 'owner_id', a.owner_id,
      'created_by', a.created_by, 'created_at', a.created_at, 'updated_at', a.updated_at
    )
  )`;

const common = {
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(1000).nullish(),
  properties: z.record(z.string(), z.unknown()).optional(),
};

/** Validates geometry + style for the given kind against the registry. */
function parseKindFields(kind: AnnotationKind, body: { geometry?: unknown; style?: unknown }, partial: boolean) {
  const def = ANNOTATION_KINDS[kind];
  const out: { geometry?: unknown; style?: unknown } = {};
  if (!partial || body.geometry !== undefined) out.geometry = parse(def.geometry, body.geometry);
  if (!partial || body.style !== undefined) out.style = parse(def.style, body.style ?? {});
  return out as { geometry?: z.infer<typeof def.geometry>; style?: z.infer<typeof def.style> };
}

const GEOM = (n: number) => `ST_SetSRID(ST_GeomFromGeoJSON($${n}::text), 4326)::geography`;

export async function annotationRoutes(app: FastifyInstance) {
  app.get('/api/annotations', { preHandler: readAccess }, async (req) => {
    const q = parse(
      z.object({ kind: kindSchema.optional(), bbox: bboxParam.optional(), scope: z.enum(['personal', 'shared']).optional() }),
      req.query,
    );
    const params: unknown[] = [viewerId(req)];
    const where = [visibleSql('a', 1)];
    if (q.kind) {
      params.push(q.kind);
      where.push(`a.kind = $${params.length}`);
    }
    if (q.scope) where.push(q.scope === 'shared' ? 'a.owner_id IS NULL' : 'a.owner_id = $1::uuid');
    if (q.bbox) {
      // A map viewport is a lon/lat rectangle, so compare as planar geometry (a geography box
      // wider than 180° would be read the short way round). minLon > maxLon crosses the
      // antimeridian: test both halves. Uses the annotations_geom_planar index.
      const [x1, y1, x2, y2] = q.bbox;
      const boxes = x1 <= x2 ? [[x1, y1, x2, y2]] : [[x1, y1, 180, y2], [-180, y1, x2, y2]];
      const parts = boxes.map((box) => {
        params.push(...box);
        const n = params.length;
        return `a.geom::geometry && ST_MakeEnvelope($${n - 3}, $${n - 2}, $${n - 1}, $${n}, 4326)`;
      });
      where.push(`(${parts.join(' OR ')})`);
    }
    const { rows } = await pool.query(
      `SELECT ${FEATURE} AS f FROM annotations a WHERE ${where.join(' AND ')} ORDER BY a.created_at DESC LIMIT 5000`,
      params,
    );
    return { type: 'FeatureCollection', features: rows.map((r) => r.f) };
  });

  app.get('/api/annotations/:id', { preHandler: readAccess }, async (req) => {
    const { id } = parse(uuidParam, req.params);
    const { rows } = await pool.query(`SELECT ${FEATURE} AS f FROM annotations a WHERE a.id = $1 AND ${visibleSql('a', 2)}`, [
      id,
      viewerId(req),
    ]);
    if (!rows[0]) throw notFound('Annotation');
    return rows[0].f;
  });

  app.post('/api/annotations', { preHandler: requireRole('viewer') }, async (req, reply) => {
    const raw = (req.body ?? {}) as Record<string, unknown>;
    const b = parse(z.object({ kind: kindSchema, scope: z.enum(['personal', 'shared']).default('personal'), ...common }).passthrough(), raw);
    const { geometry, style } = parseKindFields(b.kind, raw, false);
    const user = req.user!;
    const ownerId = ownerFor(b.scope, user, 'annotations');
    const feature = await withTransaction(async (c) => {
      if (ownerId) await enforcePersonalCap(c, 'annotations', ownerId, MAX_PERSONAL_ANNOTATIONS, 'map annotations');
      const { rows } = await c.query(
        `WITH a AS (
           INSERT INTO annotations (kind, geom, name, description, style, properties, owner_id, created_by)
           VALUES ($1, ${GEOM(2)}, $3, $4, $5, $6, $7, $8) RETURNING *
         ) SELECT ${FEATURE} AS f FROM a`,
        [b.kind, JSON.stringify(geometry), b.name, b.description ?? null, style, b.properties ?? {}, ownerId, user.id],
      );
      await audit(user.id, 'annotation.create', 'annotation', rows[0].f.id, { kind: b.kind, scope: b.scope }, c);
      return rows[0].f;
    });
    return reply.status(201).send(feature);
  });

  app.patch('/api/annotations/:id', { preHandler: requireRole('viewer') }, async (req) => {
    const { id } = parse(uuidParam, req.params);
    const raw = (req.body ?? {}) as Record<string, unknown>;
    const b = parse(z.object({ name: common.name.optional(), description: common.description, properties: common.properties }).passthrough(), raw);
    return withTransaction(async (c) => {
      const { kind } = await assertEditable<{ kind: AnnotationKind }>(c, 'annotations', id, req.user!, 'Annotation', ['kind']);
      const { geometry, style } = parseKindFields(kind, raw, true);
      const { rows } = await c.query(
        `WITH a AS (
           UPDATE annotations SET
             name        = COALESCE($2, name),
             description = CASE WHEN $3::boolean THEN $4 ELSE description END,
             geom        = CASE WHEN $5::text IS NULL THEN geom ELSE ${GEOM(5)} END,
             style       = COALESCE($6, style),
             properties  = COALESCE($7, properties),
             updated_at  = now()
           WHERE id = $1 RETURNING *
         ) SELECT ${FEATURE} AS f FROM a`,
        [
          id, b.name ?? null, b.description !== undefined, b.description ?? null,
          geometry ? JSON.stringify(geometry) : null, style ?? null, b.properties ?? null,
        ],
      );
      await audit(req.user!.id, 'annotation.update', 'annotation', id, { fields: Object.keys(raw) }, c);
      return rows[0].f;
    });
  });

  app.delete('/api/annotations/:id', { preHandler: requireRole('viewer') }, async (req, reply) => {
    const { id } = parse(uuidParam, req.params);
    await withTransaction(async (c) => {
      await assertEditable(c, 'annotations', id, req.user!, 'Annotation');
      await c.query(`DELETE FROM annotations WHERE id = $1`, [id]);
      await audit(req.user!.id, 'annotation.delete', 'annotation', id, {}, c);
    });
    return reply.status(204).send();
  });
}

