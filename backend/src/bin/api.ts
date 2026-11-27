import { loadCorpus, syncKnowledge } from '../ai/knowledge.js';
import { buildServer, knowledgeEmbedder } from '../api/server.js';
import { startHeartbeat } from '../db/maintenance.js';
import { config } from '../config.js';
import { pool } from '../db/pool.js';
import { logger } from '../shared/logger.js';
import { createRedis } from '../shared/redis.js';

const redis = createRedis('api');
const subscriber = createRedis('api-sub');
const app = await buildServer({ redis, subscriber });

await app.listen({ port: config.PORT, host: config.HOST });
// Supabase free plan: keep the database counted as active even when nobody uses the app.
const stopHeartbeat = startHeartbeat('api');

// Knowledge base: write changed notes and embed them (unchanged notes cost nothing). One server at a time.
void (async () => {
  const client = await pool.connect();
  try {
    const { rows } = await client.query<{ ok: boolean }>(`SELECT pg_try_advisory_lock(hashtext('knowledge-sync')) AS ok`);
    if (!rows[0]!.ok) return;
    try {
      const r = await syncKnowledge((sql, params) => client.query(sql, params), await loadCorpus(), knowledgeEmbedder());
      if (r.written || r.removed || r.embedded) logger.info(r, 'knowledge base updated');
    } finally {
      await client.query(`SELECT pg_advisory_unlock(hashtext('knowledge-sync'))`);
    }
  } catch (err) {
    logger.warn({ err: (err as Error).message }, 'knowledge base sync failed (search falls back to keywords)');
  } finally {
    client.release();
  }
})();

async function shutdown(signal: string) {
  logger.info({ signal }, 'api shutting down');
  stopHeartbeat();
  await app.close();
  await Promise.allSettled([pool.end(), redis.quit(), subscriber.quit()]);
  process.exit(0);
}
process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));
