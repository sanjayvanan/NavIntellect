import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { pool } from '../../db/pool.js';
import { requireRole } from '../auth/guard.js';
import { hashPassword, verifyPassword } from '../auth/password.js';
import { issueRefreshToken, revokeRefreshToken, rotateRefreshToken, signAccessToken, type Role } from '../auth/tokens.js';
import { HttpError, parse } from '../errors.js';

const loginBody = z.object({ email: z.email(), password: z.string().min(1).max(256) });
const refreshBody = z.object({ refresh_token: z.string().min(10) });

// Computed once so unknown-user logins take as long as wrong-password logins.
const dummyHash = hashPassword('timing-equaliser-not-a-real-password');

export async function authRoutes(app: FastifyInstance) {
  const strict = { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } };

  app.post('/api/auth/login', strict, async (req) => {
    const { email, password } = parse(loginBody, req.body);
    const { rows } = await pool.query<{ id: string; email: string; role: Role; password_hash: string; disabled: boolean }>(
      `SELECT id, email::text, role, password_hash, disabled FROM users WHERE email = $1`,
      [email],
    );
    const u = rows[0];
    const ok = await verifyPassword(u?.password_hash ?? (await dummyHash), password);
    if (!u || !ok || u.disabled) throw new HttpError(401, 'Invalid email or password');
    await pool.query(`UPDATE users SET last_login_at = now() WHERE id = $1`, [u.id]);
    const user = { id: u.id, email: u.email, role: u.role };
    const [access, refresh] = await Promise.all([signAccessToken(user), issueRefreshToken(u.id)]);
    return { access_token: access, refresh_token: refresh.token, token_type: 'Bearer', user };
  });

  app.post('/api/auth/refresh', strict, async (req) => {
    const { refresh_token } = parse(refreshBody, req.body);
    const { user, refreshToken } = await rotateRefreshToken(refresh_token);
    return { access_token: await signAccessToken(user), refresh_token: refreshToken, token_type: 'Bearer', user };
  });

  app.post('/api/auth/logout', async (req, reply) => {
    const { refresh_token } = parse(refreshBody, req.body);
    await revokeRefreshToken(refresh_token);
    return reply.status(204).send();
  });

  app.get('/api/auth/me', { preHandler: requireRole('viewer') }, async (req) => req.user);

  app.post('/api/auth/password', { preHandler: requireRole('viewer') }, async (req, reply) => {
    const b = parse(z.object({ current_password: z.string(), new_password: z.string().min(10).max(256) }), req.body);
    const { rows } = await pool.query<{ password_hash: string }>(`SELECT password_hash FROM users WHERE id = $1`, [req.user!.id]);
    if (!rows[0] || !(await verifyPassword(rows[0].password_hash, b.current_password))) {
      throw new HttpError(401, 'Current password is incorrect');
    }
    await pool.query(`UPDATE users SET password_hash = $2, updated_at = now() WHERE id = $1`, [req.user!.id, await hashPassword(b.new_password)]);
    await pool.query(`UPDATE refresh_tokens SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL`, [req.user!.id]);
    return reply.status(204).send();
  });
}
