/**
 * Replays a JSONL capture through the real pipeline (DB write, Redis publish, alerts).
 *   npm run replay -- test/fixtures/aisstream-sample.jsonl [--shift]
 * --shift moves message times so the newest one is "now" (useful for demos with old captures).
 */
import { readFile } from 'node:fs/promises';
import { config } from '../src/config.js';
import { pool } from '../src/db/pool.js';
import { normalize } from '../src/ingest/normalize.js';
import { createPipeline } from '../src/ingest/pipeline.js';
import { createRedis } from '../src/shared/redis.js';

const path = process.argv[2];
if (!path) throw new Error('usage: npm run replay -- <file.jsonl> [--shift]');
const shift = process.argv.includes('--shift');

const msgs = (await readFile(path, 'utf8')).split('\n').filter(Boolean).flatMap((l) => normalize(JSON.parse(l)));
if (shift && msgs.length) {
  const newest = Math.max(...msgs.map((m) => m.ts.getTime()));
  const delta = Date.now() - newest;
  for (const m of msgs) m.ts = new Date(m.ts.getTime() + delta);
}
const redis = createRedis('replay');
const { batcher } = createPipeline({
  redis, flushIntervalMs: 1000, maxRows: config.FLUSH_MAX_ROWS, maxBuffer: Number.MAX_SAFE_INTEGER,
  alertCooldownMinutes: config.ALERT_COOLDOWN_MINUTES,
});
batcher.push(...msgs);
await batcher.stop();
console.log(`replayed ${msgs.length} normalized messages`, batcher.stats);
await Promise.allSettled([pool.end(), redis.quit()]);
