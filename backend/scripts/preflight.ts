/** Runs before `npm run dev`: checks Postgres (Supabase) and Redis are reachable, then applies migrations. */
import { Redis } from 'ioredis';
import { config } from '../src/config.js';
import { migrate } from '../src/db/migrate.js';
import { pool } from '../src/db/pool.js';

const host = (() => { try { return new URL(config.DATABASE_URL).host; } catch { return '(invalid DATABASE_URL)'; } })();

const redis = new Redis(config.REDIS_URL, { lazyConnect: true, maxRetriesPerRequest: 0, retryStrategy: () => null });
redis.on('error', () => {});
try {
  await redis.connect();
  await redis.ping();
  console.log(`✔ redis ${config.REDIS_URL}`);
} catch {
  console.error(`✖ Redis is not reachable at ${config.REDIS_URL}\n  Start it with: brew services start redis   (or: redis-server --daemonize yes)`);
  process.exit(1);
} finally {
  redis.disconnect();
}

let client;
try {
  client = await pool.connect();
  const { rows } = await client.query<{ v: string }>(`SELECT current_setting('server_version') AS v`);
  console.log(`✔ postgres ${host} (v${rows[0]!.v})`);
} catch (err) {
  console.error(`✖ Cannot connect to Postgres at ${host}: ${(err as Error).message}`);
  console.error('  Check DATABASE_URL in backend/.env (Supabase → Connect → Session pooler URI).');
  process.exit(1);
}
try {
  const applied = await migrate(client, config.DB_SCHEMA, (m) => console.log(`  ${m}`));
  console.log(`✔ schema "${config.DB_SCHEMA}" ${applied.length ? `migrated (${applied.length})` : 'up to date'}`);
} finally {
  client.release();
  await pool.end();
}
