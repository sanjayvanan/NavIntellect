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

export async function withTransaction<T>(fn: (client: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}
