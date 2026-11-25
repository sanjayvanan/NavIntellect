import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { audit } from '../../db/audit.js';
import { pool } from '../../db/pool.js';
import { requireRole } from '../auth/guard.js';
import { hashPassword } from '../auth/password.js';
import { HttpError, notFound, parse, uuidParam } from '../errors.js';

const role = z.enum(['admin', 'operator', 'viewer']);
const USER_COLS = `id, email::text, role, disabled, created_at, updated_at, last_login_at`;

export async function userRoutes(app: FastifyInstance) {
  const admin = { preHandler: requireRole('admin') };

  app.get('/api/users', admin, async () => (await pool.query(`SELECT ${USER_COLS} FROM users ORDER BY created_at`)).rows);

  app.post('/api/users', admin, async (req, reply) => {
    const b = parse(z.object({ email: z.email(), password: z.string().min(10).max(256), role: role.default('viewer') }), req.body);
    const { rows } = await pool.query(
      `INSERT INTO users (email, password_hash, role) VALUES ($1, $2, $3) RETURNING ${USER_COLS}`,
      [b.email, await hashPassword(b.password), b.role],
    );
    await audit(req.user!.id, 'user.create', 'user', rows[0].id, { email: b.email, role: b.role });
    return reply.status(201).send(rows[0]);
  });

  app.patch('/api/users/:id', admin, async (req) => {
    const { id } = parse(uuidParam, req.params);
    const b = parse(z.object({ role: role.optional(), disabled: z.boolean().optional(), password: z.string().min(10).max(256).optional() }), req.body);
    if (id === req.user!.id && (b.role && b.role !== 'admin' || b.disabled)) {
      throw new HttpError(400, 'You cannot demote or disable yourself');
    }
    const { rows } = await pool.query(
      `UPDATE users SET role = COALESCE($2, role), disabled = COALESCE($3, disabled),
                        password_hash = COALESCE($4, password_hash), updated_at = now()
       WHERE id = $1 RETURNING ${USER_COLS}`,
      [id, b.role ?? null, b.disabled ?? null, b.password ? await hashPassword(b.password) : null],
    );
    if (!rows[0]) throw notFound('User');
    if (b.disabled || b.password) {
      await pool.query(`UPDATE refresh_tokens SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL`, [id]);
    }
    await audit(req.user!.id, 'user.update', 'user', id, { fields: Object.keys(b) });
    return rows[0];
  });

  app.get('/api/audit', admin, async (req) => {
    const { limit } = parse(z.object({ limit: z.coerce.number().int().min(1).max(500).default(100) }), req.query);
    const { rows } = await pool.query(
      `SELECT a.*, u.email::text AS user_email FROM audit_log a LEFT JOIN users u ON u.id = a.user_id
       ORDER BY a.created_at DESC LIMIT $1`,
      [limit],
    );
    return rows;
  });
}
