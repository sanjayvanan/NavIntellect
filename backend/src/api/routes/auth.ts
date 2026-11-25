import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { config } from '../../config.js';
import { audit } from '../../db/audit.js';
import { pool } from '../../db/pool.js';
import { requireRole } from '../auth/guard.js';
import { hashPassword, verifyPassword } from '../auth/password.js';
import { issueRefreshToken, revokeRefreshToken, rotateRefreshToken, signAccessToken, type Role } from '../auth/tokens.js';
import { HttpError, parse } from '../errors.js';

const loginBody = z.object({ email: z.email(), password: z.string().min(1).max(256) });
const registerBody = z.object({
  email: z.email().max(254),
  password: z.string().min(10, 'Password must be at least 10 characters').max(256),
  name: z.string().trim().min(1).max(80).optional(),
});
const refreshBody = z.object({ refresh_token: z.string().min(10) });

// Computed once so unknown-user logins take as long as wrong-password logins.
const dummyHash = hashPassword('timing-equaliser-not-a-real-password');

export async function authRoutes(app: FastifyInstance) {
  const strict = { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } };

  app.post('/api/auth/login', strict, async (req) => {
    const { email, password } = parse(loginBody, req.body);
    const { rows } = await pool.query<{ id: string; email: string; role: Role; password_hash: string; disabled: boolean; name: string | null }>(
      `SELECT id, email::text, role, password_hash, disabled, display_name AS name FROM users WHERE email = $1`,
      [email],
    );
    const u = rows[0];
    const ok = await verifyPassword(u?.password_hash ?? (await dummyHash), password);
    if (!u || !ok || u.disabled) throw new HttpError(401, 'Invalid email or password');
    await pool.query(`UPDATE users SET last_login_at = now() WHERE id = $1`, [u.id]);
    const user = { id: u.id, email: u.email, role: u.role };
    const [access, refresh] = await Promise.all([signAccessToken(user), issueRefreshToken(u.id)]);
    return { access_token: access, refresh_token: refresh.token, token_type: 'Bearer', user: { ...user, name: u.name } };
  });

  // Self-service sign-up. Always creates a viewer: roles are only ever raised by an admin.
  app.post('/api/auth/register', strict, async (req, reply) => {
    if (!config.ALLOW_REGISTRATION) throw new HttpError(403, 'Registration is disabled');
    const { email, password, name } = parse(registerBody, req.body);
    const { rows } = await pool.query<{ id: string; email: string; role: Role }>(
      `INSERT INTO users (email, password_hash, role, display_name, last_login_at)
       VALUES ($1, $2, 'viewer', $3, now())
       ON CONFLICT (email) DO NOTHING
       RETURNING id, email::text, role`,
      [email, await hashPassword(password), name ?? null],
    );
    if (!rows[0]) throw new HttpError(409, 'An account with this email already exists');
    const user = rows[0];
    await audit(user.id, 'user.register', 'user', user.id, { email: user.email });
    const [access, refresh] = await Promise.all([signAccessToken(user), issueRefreshToken(user.id)]);
    return reply.status(201).send({ access_token: access, refresh_token: refresh.token, token_type: 'Bearer', user: { ...user, name: name ?? null } });
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

  app.get('/api/auth/me', { preHandler: requireRole('viewer') }, async (req) => {
    const { rows } = await pool.query(
      `SELECT id, email::text, role, display_name AS name, created_at, last_login_at FROM users WHERE id = $1`,
      [req.user!.id],
    );
    if (!rows[0]) throw new HttpError(401, 'Account no longer exists');
    return rows[0];
  });

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
