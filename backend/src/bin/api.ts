import { buildServer } from '../api/server.js';
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

async function shutdown(signal: string) {
  logger.info({ signal }, 'api shutting down');
  stopHeartbeat();
  await app.close();
  await Promise.allSettled([pool.end(), redis.quit(), subscriber.quit()]);
  process.exit(0);
}
process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));
