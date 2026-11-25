import type { FastifyInstance } from 'fastify';
import type { Redis } from 'ioredis';
import { config } from '../../config.js';
import { pool } from '../../db/pool.js';
import { INGEST_STATS_KEY } from '../../shared/redis.js';

export async function healthRoutes(app: FastifyInstance, opts: { redis: Redis }) {
  const ingestStats = async () => {
    const raw = await opts.redis.get(INGEST_STATS_KEY).catch(() => null);
    return raw ? (JSON.parse(raw) as Record<string, unknown>) : null;
  };

  app.get('/api/health', async (_req, reply) => {
    const [db, redis, ingest] = await Promise.all([
      pool.query('SELECT 1').then(() => true, () => false),
      opts.redis.ping().then(() => true, () => false),
      ingestStats(),
    ]);
    const { rows } = db
      ? await pool.query<{ age_s: number | null }>(`SELECT extract(epoch FROM now() - max(updated_at))::float8 AS age_s FROM vessel_latest`)
      : { rows: [{ age_s: null }] };
    const lastWriteAgeS = rows[0]?.age_s ?? null;
    const ok = db && redis;
    return reply.status(ok ? 200 : 503).send({
      status: ok ? (ingest?.connected && lastWriteAgeS != null && lastWriteAgeS < 120 ? 'ok' : 'degraded') : 'down',
      db, redis,
      ingest: { connected: Boolean(ingest?.connected), last_write_age_s: lastWriteAgeS },
    });
  });

  app.get('/api/stats', async () => {
    const [{ rows }, ingest] = await Promise.all([
      pool.query(
        `SELECT
           (SELECT count(*)::int FROM vessels) AS vessels_known,
           (SELECT count(*)::int FROM vessel_latest WHERE ts > now() - interval '1 hour') AS vessels_active_1h,
           (SELECT count(*)::int FROM vessel_latest WHERE ts > now() - interval '24 hours') AS vessels_active_24h,
           (SELECT count(*)::int FROM zones WHERE active) AS zones_active,
           (SELECT count(*)::int FROM alerts WHERE acknowledged_at IS NULL) AS alerts_open,
           (SELECT COALESCE(sum(GREATEST(c.reltuples, 0)), 0)::float8 FROM pg_inherits i JOIN pg_class c ON c.oid = i.inhrelid
             WHERE i.inhparent = 'vessel_positions'::regclass) AS raw_positions_approx,
           (SELECT COALESCE(sum(pg_total_relation_size(i.inhrelid)), 0)::float8 FROM pg_inherits i
             WHERE i.inhparent = 'vessel_positions'::regclass) AS raw_bytes,
           (SELECT count(*)::int FROM pg_inherits i WHERE i.inhparent = 'vessel_positions'::regclass) AS raw_partitions,
           (SELECT COALESCE(sum(bytes), 0)::float8 FROM track_partitions()) AS tracks_bytes,
           (SELECT count(*)::int FROM track_partitions()) AS track_days,
           (SELECT min(block_start) FROM vessel_tracks) AS tracks_oldest,
           (SELECT value FROM job_state WHERE name = 'tracks') AS tracks_watermark,
           pg_database_size(current_database())::float8 AS db_bytes`,
      ),
      ingestStats(),
    ]);
    const r = rows[0];
    const limitBytes = config.DB_SIZE_LIMIT_MB * 1024 * 1024;
    return {
      ...r,
      db_limit_bytes: limitBytes,
      db_used_pct: Math.round((r.db_bytes / limitBytes) * 1000) / 10,
      ingest,
    };
  });
}
