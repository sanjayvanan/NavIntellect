import type { FastifyRequest } from 'fastify';
import type pg from 'pg';
import { HttpError, notFound } from '../errors.js';
import type { AuthUser } from './tokens.js';

/**
 * Ownership scopes shared by user-created map objects (zones, annotations, …).
 *
 *  - shared   (owner_id IS NULL): visible to everyone; created and changed by operators/admins
 *  - personal (owner_id = user):  visible to and managed by that user only
 *
 * Rows another user can't see answer 404 (never 403), so their existence isn't revealed.
 * Tables using this need an `owner_id uuid` column (NULL = shared).
 */
export type Scope = 'personal' | 'shared';

/** Tables that follow the scope model. A fixed list: table names are interpolated into SQL. */
export type ScopedTable = 'zones' | 'annotations';

/** SQL predicate: row alias `alias` is visible to the user id bound at `$n` (NULL = anonymous). */
export const visibleSql = (alias: string, n: number) => `(${alias}.owner_id IS NULL OR ${alias}.owner_id = $${n}::uuid)`;

/** SQL expression giving 'shared' | 'personal' for row alias `alias`. */
export const scopeSql = (alias: string) => `CASE WHEN ${alias}.owner_id IS NULL THEN 'shared' ELSE 'personal' END`;

export const viewerId = (req: FastifyRequest): string | null => req.user?.id ?? null;

export const isOperator = (u: AuthUser | null | undefined) => u?.role === 'operator' || u?.role === 'admin';

/** owner_id for a new row in `scope`; throws 403 when a non-operator asks for a shared one. */
export function ownerFor(scope: Scope, user: AuthUser, what: string): string | null {
  if (scope === 'shared' && !isOperator(user)) throw new HttpError(403, `Only operators can create shared ${what}`);
  return scope === 'personal' ? user.id : null;
}

/**
 * Checks the signed-in user may change row `id` of `table`: 404 if they can't see it,
 * 403 if it is shared and they aren't an operator. Returns the row's owner_id plus any
 * `extraColumns` (a fixed list chosen by the caller, so the check costs no extra round trip).
 */
export async function assertEditable<T extends Record<string, unknown> = Record<string, never>>(
  client: pg.Pool | pg.ClientBase,
  table: ScopedTable,
  id: string,
  user: AuthUser,
  what: string,
  extraColumns: readonly string[] = [],
): Promise<{ owner_id: string | null } & T> {
  const cols = ['owner_id', ...extraColumns.map((c) => `t.${c}`)].join(', ');
  const { rows } = await client.query<{ owner_id: string | null } & T>(
    `SELECT ${cols} FROM ${table} t WHERE t.id = $1 AND ${visibleSql('t', 2)}`,
    [id, user.id],
  );
  const row = rows[0];
  if (!row) throw notFound(what);
  if (row.owner_id === null && !isOperator(user)) throw new HttpError(403, `Only operators can change shared ${what.toLowerCase()}s`);
  return row;
}

/**
 * Caps how many personal rows a user may keep in `table` (protects the free-tier database).
 * Call inside a transaction: the advisory lock serialises concurrent creates by the same user.
 */
export async function enforcePersonalCap(client: pg.ClientBase, table: ScopedTable, ownerId: string, max: number, what: string) {
  await client.query(`SELECT pg_advisory_xact_lock(hashtext($1 || ':' || $2))`, [table, ownerId]);
  const { rows } = await client.query<{ n: number }>(`SELECT count(*)::int AS n FROM ${table} WHERE owner_id = $1`, [ownerId]);
  if (rows[0]!.n >= max) throw new HttpError(409, `You can keep at most ${max} personal ${what}`);
}
