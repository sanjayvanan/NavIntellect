import { readFileSync } from 'node:fs';
import type pg from 'pg';

/**
 * Builds node-pg connection options for local Postgres or Supabase.
 * - SSL is on for any non-local host. Supabase uses its own CA: set DATABASE_SSL_CA to the
 *   downloaded certificate (Dashboard → Database → SSL) for full verification; otherwise the
 *   connection is encrypted but the certificate isn't verified.
 * - `sslmode` is stripped from the URL because node-pg lets it override the `ssl` object.
 */
export function connectionOptions(url: string, opts: { ssl?: string; sslCa?: string } = {}): pg.ClientConfig {
  const u = new URL(url);
  u.searchParams.delete('sslmode');
  const local = ['localhost', '127.0.0.1', '::1', ''].includes(u.hostname) || u.hostname.endsWith('.local');
  const mode = opts.ssl ?? 'auto';
  const useSsl = mode === 'true' || (mode === 'auto' && !local);
  return {
    connectionString: u.toString(),
    ssl: useSsl
      ? opts.sslCa
        ? { ca: readFileSync(opts.sslCa, 'utf8'), rejectUnauthorized: true }
        : { rejectUnauthorized: false }
      : false,
  };
}

/** Our tables live in their own schema (default `ais`), which Supabase's REST API does not expose.
 *  `extensions` is where Supabase installs PostGIS/pg_trgm/etc. */
export function searchPathSql(schema: string): string {
  if (!/^[a-z_][a-z0-9_]*$/.test(schema)) throw new Error(`invalid DB_SCHEMA: ${schema}`);
  return `SET search_path TO ${schema}, extensions, public`;
}

/** search_path as a libpq startup option, so it is set before the first query on every pooled connection. */
export function searchPathOption(schema: string): string {
  searchPathSql(schema); // validates the name
  return `-c search_path=${schema},extensions,public`;
}
