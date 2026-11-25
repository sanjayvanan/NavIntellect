import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { pool } from '../../db/pool.js';
import { requireRole } from '../auth/guard.js';
import { parse } from '../errors.js';

/**
 * Per-user settings document (theme, last map view, layers, display options).
 * Known keys are type-checked; unknown keys pass through so the client can add settings
 * without a backend change. Size is capped by the route's bodyLimit.
 */
const settingsSchema = z
  .looseObject({
    mode: z.enum(['light', 'dark']).optional(),
    view: z
      .object({ lat: z.number().min(-90).max(90), lng: z.number().min(-180).max(180), zoom: z.number().min(0).max(22) })
      .nullish(), // null = not moved yet (world overview)
    baseLayer: z.string().max(100).optional(),
    overlays: z.array(z.string().max(100)).max(50).optional(),
  });

// Room for ~1,000 hidden ids per map-object type (≈ 39 bytes each) plus the rest of the settings.
const PREFS_LIMIT = 128 * 1024;

export async function preferenceRoutes(app: FastifyInstance) {
  const viewer = { preHandler: requireRole('viewer') };

  app.get('/api/me/preferences', viewer, async (req) => {
    const { rows } = await pool.query<{ settings: Record<string, unknown>; updated_at: Date }>(
      `SELECT settings, updated_at FROM user_preferences WHERE user_id = $1`,
      [req.user!.id],
    );
    return rows[0] ?? { settings: {}, updated_at: null };
  });

  // Replaces the whole document (the client always sends its full settings).
  app.put('/api/me/preferences', { ...viewer, bodyLimit: PREFS_LIMIT }, async (req) => {
    const { settings } = parse(z.object({ settings: settingsSchema }), req.body);
    const { rows } = await pool.query(
      `INSERT INTO user_preferences (user_id, settings, updated_at) VALUES ($1, $2, now())
       ON CONFLICT (user_id) DO UPDATE SET settings = EXCLUDED.settings, updated_at = now()
       RETURNING settings, updated_at`,
      [req.user!.id, settings],
    );
    return rows[0];
  });

  app.delete('/api/me/preferences', viewer, async (req, reply) => {
    await pool.query(`DELETE FROM user_preferences WHERE user_id = $1`, [req.user!.id]);
    return reply.status(204).send();
  });
}
