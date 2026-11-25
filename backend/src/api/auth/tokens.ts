import { createHash, randomBytes } from 'node:crypto';
import { jwtVerify, SignJWT } from 'jose';
import type pg from 'pg';
import { config } from '../../config.js';
import { pool, withTransaction } from '../../db/pool.js';
import { HttpError } from '../errors.js';

export type Role = 'admin' | 'operator' | 'viewer';
export interface AuthUser {
  id: string;
  email: string;
  role: Role;
}

const secret = new TextEncoder().encode(config.JWT_SECRET);
const ISSUER = 'coastal-surveillance';

export async function signAccessToken(user: AuthUser): Promise<string> {
  return new SignJWT({ email: user.email, role: user.role })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(user.id)
    .setIssuer(ISSUER)
    .setIssuedAt()
    .setExpirationTime(config.ACCESS_TOKEN_TTL)
    .sign(secret);
}

export async function verifyAccessToken(token: string): Promise<AuthUser> {
  try {
    const { payload } = await jwtVerify(token, secret, { issuer: ISSUER, algorithms: ['HS256'] });
    return { id: payload.sub!, email: String(payload.email), role: payload.role as Role };
  } catch {
    throw new HttpError(401, 'Invalid or expired token');
  }
}

const sha256 = (s: string) => createHash('sha256').update(s).digest();

/** Opaque refresh token; only its hash is stored. */
export async function issueRefreshToken(userId: string, client: pg.Pool | pg.ClientBase = pool): Promise<{ token: string; id: string }> {
  const token = randomBytes(32).toString('base64url');
  const { rows } = await client.query<{ id: string }>(
    `INSERT INTO refresh_tokens (user_id, token_hash, expires_at)
     VALUES ($1, $2, now() + make_interval(days => $3)) RETURNING id`,
    [userId, sha256(token), config.REFRESH_TOKEN_TTL_DAYS],
  );
  return { token, id: rows[0]!.id };
}

/**
 * Rotates a refresh token. Presenting an already-rotated token is treated as theft:
 * every session of that user is revoked.
 */
export async function rotateRefreshToken(token: string): Promise<{ user: AuthUser; refreshToken: string }> {
  type Outcome = { error: string } | { user: AuthUser; refreshToken: string };
  const outcome = await withTransaction(async (client): Promise<Outcome> => {
    const { rows } = await client.query<{
      id: string; user_id: string; expires_at: Date; revoked_at: Date | null;
      email: string; role: Role; disabled: boolean;
    }>(
      `SELECT t.id, t.user_id, t.expires_at, t.revoked_at, u.email, u.role, u.disabled
       FROM refresh_tokens t JOIN users u ON u.id = t.user_id
       WHERE t.token_hash = $1 FOR UPDATE OF t`,
      [sha256(token)],
    );
    const row = rows[0];
    if (!row) return { error: 'Invalid refresh token' };
    if (row.revoked_at) {
      await client.query(`UPDATE refresh_tokens SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL`, [row.user_id]);
      return { error: 'Refresh token reuse detected; all sessions revoked' };
    }
    if (row.expires_at < new Date() || row.disabled) return { error: 'Refresh token expired' };
    const next = await issueRefreshToken(row.user_id, client);
    await client.query(`UPDATE refresh_tokens SET revoked_at = now(), replaced_by = $2 WHERE id = $1`, [row.id, next.id]);
    return { user: { id: row.user_id, email: row.email, role: row.role }, refreshToken: next.token };
  });
  // Throw after commit so the reuse-revocation is persisted.
  if ('error' in outcome) throw new HttpError(401, outcome.error);
  return outcome;
}

export async function revokeRefreshToken(token: string): Promise<void> {
  await pool.query(`UPDATE refresh_tokens SET revoked_at = now() WHERE token_hash = $1 AND revoked_at IS NULL`, [sha256(token)]);
}
