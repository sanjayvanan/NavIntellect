import type { FastifyError, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { logger } from '../shared/logger.js';

export class HttpError extends Error {
  constructor(public statusCode: number, message: string, public details?: unknown) {
    super(message);
  }
}

export const notFound = (what = 'Resource') => new HttpError(404, `${what} not found`);

/** Validates input with zod, throwing a 400 with field-level issues on failure. */
export function parse<T extends z.ZodType>(schema: T, data: unknown): z.infer<T> {
  const r = schema.safeParse(data);
  if (!r.success) {
    throw new HttpError(400, 'Validation failed', r.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })));
  }
  return r.data;
}

export function errorHandler(err: FastifyError | HttpError | Error, req: FastifyRequest, reply: FastifyReply) {
  if (err instanceof HttpError) {
    return reply.status(err.statusCode).send({ error: err.message, ...(err.details ? { details: err.details } : {}) });
  }
  const status = (err as FastifyError).statusCode;
  if (status && status < 500) return reply.status(status).send({ error: err.message });
  // Postgres invalid input (bad uuid, invalid geometry, etc.)
  const pgCode = (err as { code?: string }).code;
  if (pgCode === '22P02' || pgCode === 'XX000' || pgCode === '22023') {
    return reply.status(400).send({ error: 'Invalid input', detail: err.message });
  }
  if (pgCode === '23505') return reply.status(409).send({ error: 'Already exists' });
  logger.error({ err, url: req.url }, 'unhandled error');
  return reply.status(500).send({ error: 'Internal server error' });
}

// ---- shared zod pieces ----

/** bbox=minLon,minLat,maxLon,maxLat (GeoJSON order). */
export const bboxParam = z
  .string()
  .transform((s) => s.split(',').map(Number))
  .pipe(
    z.tuple([z.number().min(-180).max(180), z.number().min(-90).max(90), z.number().min(-180).max(180), z.number().min(-90).max(90)]),
  );
export type BBox = z.infer<typeof bboxParam>;

/**
 * SQL predicate for a [minLon, minLat, maxLon, maxLat] box bound at $start..$start+3, on a table
 * alias with lat/lon columns. Plain lat/lon comparison (not geography) so world-sized boxes work;
 * minLon > maxLon means the box crosses the antimeridian.
 */
export function bboxSql(alias: string, start: number): string {
  const [x1, y1, x2, y2] = [start, start + 1, start + 2, start + 3].map((i) => `$${i}::float8`);
  return `(${alias}.lat BETWEEN ${y1} AND ${y2} AND CASE WHEN ${x1} <= ${x2} THEN ${alias}.lon BETWEEN ${x1} AND ${x2} ELSE (${alias}.lon >= ${x1} OR ${alias}.lon <= ${x2}) END)`;
}

export const mmsiParam = z.object({ mmsi: z.coerce.number().int().min(1).max(999_999_999) });
export const uuidParam = z.object({ id: z.uuid() });
