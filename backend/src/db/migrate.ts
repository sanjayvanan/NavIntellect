import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type pg from 'pg';
import { searchPathSql } from './connection.js';

const here = path.dirname(fileURLToPath(import.meta.url));
// Works from src/db (tsx) and dist/db (compiled): migrations/ sits at the package root.
const MIGRATIONS_DIR = path.resolve(here, '..', '..', 'migrations');

/** Minimal forward-only SQL migrator. A file starting with `-- migrate:no-transaction`
 *  runs statement-by-statement outside a transaction (needed for TimescaleDB continuous aggregates). */
export async function migrate(
  client: pg.ClientBase,
  schema: string,
  log: (msg: string) => void = console.log,
): Promise<string[]> {
  const setPath = searchPathSql(schema); // also validates the name
  await client.query(`CREATE SCHEMA IF NOT EXISTS ${schema}`);
  await client.query(setPath);
  await client.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
    name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())`);
  await client.query(`SELECT pg_advisory_lock(hashtext('ais-migrate:' || current_schema()))`);
  try {
    const { rows } = await client.query<{ name: string }>('SELECT name FROM schema_migrations');
    const done = new Set(rows.map((r) => r.name));
    const files = (await readdir(MIGRATIONS_DIR)).filter((f) => f.endsWith('.sql')).sort();
    const applied: string[] = [];
    for (const file of files) {
      if (done.has(file)) continue;
      const sql = await readFile(path.join(MIGRATIONS_DIR, file), 'utf8');
      log(`applying ${file}`);
      if (sql.startsWith('-- migrate:no-transaction')) {
        for (const stmt of splitStatements(sql)) await client.query(stmt);
        await client.query('INSERT INTO schema_migrations (name) VALUES ($1)', [file]);
      } else {
        await client.query('BEGIN');
        try {
          await client.query(sql);
          await client.query('INSERT INTO schema_migrations (name) VALUES ($1)', [file]);
          await client.query('COMMIT');
        } catch (err) {
          await client.query('ROLLBACK');
          throw new Error(`migration ${file} failed: ${(err as Error).message}`);
        }
      }
      applied.push(file);
    }
    return applied;
  } finally {
    await client.query(`SELECT pg_advisory_unlock(hashtext('ais-migrate:' || current_schema()))`);
  }
}

/** Splits on semicolons at end of line, ignoring `--` comment lines. Sufficient for our DDL files. */
function splitStatements(sql: string): string[] {
  return sql
    .split('\n')
    .filter((l) => !l.trim().startsWith('--'))
    .join('\n')
    .split(/;\s*$/m)
    .map((s) => s.trim())
    .filter(Boolean);
}
