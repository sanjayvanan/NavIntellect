import { config } from '../config.js';
import { startMaintenance } from '../db/maintenance.js';
import { pool } from '../db/pool.js';
import { AisStreamClient } from '../ingest/aisstream.js';
import { normalize, SUBSCRIBED_MESSAGE_TYPES } from '../ingest/normalize.js';
import { createPipeline } from '../ingest/pipeline.js';
import { logger } from '../shared/logger.js';
import { createRedis, INGEST_STATS_KEY } from '../shared/redis.js';

if (!config.AISSTREAM_API_KEY) {
  const msg = 'AISSTREAM_API_KEY is not set. Get a free key at https://aisstream.io and put it in backend/.env';
  if (config.NODE_ENV === 'production') {
    logger.fatal(msg);
    process.exit(1);
  }
  // In development, stay idle so `npm run dev` keeps the API running; edit .env and restart to ingest.
  logger.error(`${msg} (ingestor idle)`);
  setInterval(() => {}, 1 << 30);
  await new Promise(() => {});
}

const redis = createRedis('ingestor');
const { batcher, sweepGaps } = createPipeline({
  redis,
  flushIntervalMs: config.FLUSH_INTERVAL_MS,
  maxRows: config.FLUSH_MAX_ROWS,
  maxBuffer: config.MAX_BUFFER,
  alertCooldownMinutes: config.ALERT_COOLDOWN_MINUTES,
  historySampleSeconds: config.POSITIONS_SAMPLE_SECONDS,
  historyTurnDegrees: config.POSITIONS_TURN_DEGREES,
});

const stream = new AisStreamClient({
  apiKey: config.AISSTREAM_API_KEY,
  boundingBoxes: config.AIS_BBOXES,
  messageTypes: SUBSCRIBED_MESSAGE_TYPES,
  onMessage: (msg, receivedAt) => {
    const out = normalize(msg, receivedAt);
    if (out.length) batcher.push(...out);
  },
});

batcher.start();
stream.start();
// Replaces TimescaleDB background jobs: daily partitions, retention, 1-minute track rollup.
const stopMaintenance = startMaintenance({
  rawRetentionHours: config.RAW_RETENTION_HOURS,
  tracksRetentionDays: config.TRACKS_RETENTION_DAYS,
  latestRetentionDays: config.LATEST_RETENTION_DAYS,
  dbSizeLimitMb: config.DB_SIZE_LIMIT_MB,
});

// AIS-gap sweep every minute.
const gapTimer = setInterval(() => {
  sweepGaps(config.AIS_GAP_MINUTES).catch((err) => logger.error({ err }, 'ais gap sweep failed'));
}, 60_000);

// Stats heartbeat: logged and published to Redis for /api/health and /api/stats.
let lastReceived = 0;
const STATS_EVERY_S = 10;
const statsTimer = setInterval(() => {
  const s = batcher.stats;
  const rate = (s.received - lastReceived) / STATS_EVERY_S;
  lastReceived = s.received;
  const stats = {
    connected: stream.connected,
    msgPerSec: Math.round(rate * 10) / 10,
    rawMessages: stream.messages,
    lastMessageAt: stream.lastMessage || null,
    ...s,
    updatedAt: Date.now(),
  };
  logger.info(stats, 'ingest stats');
  redis.set(INGEST_STATS_KEY, JSON.stringify(stats), 'EX', 60).catch(() => {});
}, STATS_EVERY_S * 1000);

let shuttingDown = false;
async function shutdown(signal: string) {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info({ signal }, 'ingestor shutting down');
  clearInterval(gapTimer);
  clearInterval(statsTimer);
  stopMaintenance();
  stream.stop();
  await batcher.stop().catch((err) => logger.error({ err }, 'final flush failed'));
  await Promise.allSettled([pool.end(), redis.quit()]);
  process.exit(0);
}
process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));
