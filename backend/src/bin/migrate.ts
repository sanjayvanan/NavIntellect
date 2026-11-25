import { config } from '../config.js';
import { pool } from '../db/pool.js';
import { migrate } from '../db/migrate.js';

const client = await pool.connect();
try {
  const applied = await migrate(client, config.DB_SCHEMA);
  console.log(applied.length ? `applied ${applied.length} migration(s) to schema "${config.DB_SCHEMA}"` : 'database is up to date');
} finally {
  client.release();
  await pool.end();
}
