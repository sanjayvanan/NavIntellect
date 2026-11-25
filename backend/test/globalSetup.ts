import 'dotenv/config';
import pg from 'pg';
import { connectionOptions } from '../src/db/connection.js';
import { migrate } from '../src/db/migrate.js';

/**
 * Tests run against the same database as the app (e.g. Supabase) but in an isolated schema
 * (`ais_test` by default), recreated from scratch on every run. Override with TEST_DATABASE_URL.
 */
export default async function setup() {
  const url = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
  if (!url) {
    console.warn('DATABASE_URL not set: only unit tests can run (integration tests will fail).');
    return;
  }
  const schema = process.env.TEST_DB_SCHEMA ?? 'ais_test';
  const client = new pg.Client(connectionOptions(url, { ssl: process.env.DATABASE_SSL, sslCa: process.env.DATABASE_SSL_CA }));
  await client.connect();
  try {
    await client.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    await migrate(client, schema, () => {});
  } finally {
    await client.end();
  }
}
