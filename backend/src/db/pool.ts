import path from 'node:path';
import pg from 'pg';
import { config } from '../config.js';
import { logger } from '../shared/logger.js';
import { connectionOptions, searchPathOption } from './connection.js';

export const pool = new pg.Pool({
  ...connectionOptions(config.DATABASE_URL, { ssl: config.DATABASE_SSL, sslCa: config.DATABASE_SSL_CA }),
  options: searchPathOption(config.DB_SCHEMA),
  max: config.DATABASE_POOL_MAX,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 10_000,
  application_name: `coastal-${path.basename(process.argv[1] ?? 'app').replace(/\.[jt]s$/, '')}`,
});

pool.on('error', (err) => logger.error({ err }, 'postgres pool error'));

/**
 * A connection dropped while checked out (e.g. Supabase's pooler resetting it) is reported as an
 * 'error' event on that client; without a listener Node would crash the whole process. The query
 * in progress still fails normally. Returns a function that removes the listener.
 */
export function guardClient(client: pg.PoolClient): () => void {
  const onError = (err: Error) => logger.warn({ err: err.message }, 'postgres connection lost during a query');
  client.on('error', onError);
  return () => client.off('error', onError);
}

export async function withTransaction<T>(fn: (client: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  const unguard = guardClient(client);
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    unguard();
    client.release();
  }
}
