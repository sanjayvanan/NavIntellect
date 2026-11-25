import { Redis } from 'ioredis';
import { config } from '../config.js';
import { logger } from './logger.js';

// Namespaced by DB schema so test runs never leak into a running dev server (pub/sub ignores Redis DB numbers).
export const CHANNELS = {
  vessels: `${config.DB_SCHEMA}:ais:updates`,
  alerts: `${config.DB_SCHEMA}:alerts:new`,
} as const;

export const INGEST_STATS_KEY = `${config.DB_SCHEMA}:ingest:stats`;

export function createRedis(name: string): Redis {
  const r = new Redis(config.REDIS_URL, {
    connectionName: name,
    maxRetriesPerRequest: 3,
    retryStrategy: (times) => Math.min(times * 500, 5000),
  });
  r.on('error', (err: Error & { code?: string }) => logger.warn({ err: err.message || err.code || String(err), name }, 'redis error'));
  return r;
}
