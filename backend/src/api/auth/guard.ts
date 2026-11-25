import type { FastifyReply, FastifyRequest } from 'fastify';
import { config } from '../../config.js';
import { HttpError } from '../errors.js';
import { verifyAccessToken, type AuthUser, type Role } from './tokens.js';

declare module 'fastify' {
  interface FastifyRequest {
    user: AuthUser | null;
  }
}

const RANK: Record<Role, number> = { viewer: 1, operator: 2, admin: 3 };

export function bearerToken(req: FastifyRequest): string | null {
  const h = req.headers.authorization;
  if (h?.startsWith('Bearer ')) return h.slice(7);
  return null;
}

/** Populates req.user if a valid bearer token is present (never throws for a missing token). */
export async function attachUser(req: FastifyRequest): Promise<void> {
  const token = bearerToken(req);
  req.user = token ? await verifyAccessToken(token) : null;
}

/** For read endpoints: open unless AUTH_REQUIRED_FOR_READS=true. */
export async function readAccess(req: FastifyRequest, _reply: FastifyReply): Promise<void> {
  if (config.AUTH_REQUIRED_FOR_READS && !req.user) throw new HttpError(401, 'Authentication required');
}

export function requireRole(min: Role) {
  return async (req: FastifyRequest, _reply: FastifyReply): Promise<void> => {
    if (!req.user) throw new HttpError(401, 'Authentication required');
    if (RANK[req.user.role] < RANK[min]) throw new HttpError(403, `Requires role ${min}`);
  };
}
