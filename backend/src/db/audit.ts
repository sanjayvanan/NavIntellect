import type pg from 'pg';
import { pool } from './pool.js';

export async function audit(
  userId: string | null,
  action: string,
  entity: string,
  entityId: string | null,
  details: Record<string, unknown> = {},
  client: pg.Pool | pg.ClientBase = pool,
): Promise<void> {
  await client.query(
    `INSERT INTO audit_log (user_id, action, entity, entity_id, details) VALUES ($1, $2, $3, $4, $5)`,
    [userId, action, entity, entityId, details],
  );
}
