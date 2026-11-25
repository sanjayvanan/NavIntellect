/**
 * Records raw aisstream.io messages to a JSONL file, then reports how the normalizer handles them.
 *   npm run capture -- [seconds=30] [out=test/fixtures/aisstream-sample.jsonl]
 * Use it to check normalize.ts against the live wire format.
 */
import { createWriteStream } from 'node:fs';
import { config } from '../src/config.js';
import { AisStreamClient } from '../src/ingest/aisstream.js';
import { normalize, parseAisstreamTime, SUBSCRIBED_MESSAGE_TYPES } from '../src/ingest/normalize.js';

const seconds = Number(process.argv[2] ?? 30);
const out = process.argv[3] ?? 'test/fixtures/aisstream-sample.jsonl';
if (!config.AISSTREAM_API_KEY) throw new Error('Set AISSTREAM_API_KEY in backend/.env');

const file = createWriteStream(out);
const counts = new Map<string, { raw: number; normalized: number }>();
let total = 0;
let badTime = 0; // MetaData.time_utc missing or unparseable (normalizer silently falls back to receive time)

const client = new AisStreamClient({
  apiKey: config.AISSTREAM_API_KEY,
  boundingBoxes: config.AIS_BBOXES,
  messageTypes: SUBSCRIBED_MESSAGE_TYPES,
  onMessage: (msg) => {
    total++;
    file.write(JSON.stringify(msg) + '\n');
    const type = (msg as { MessageType: string }).MessageType;
    const c = counts.get(type) ?? { raw: 0, normalized: 0 };
    c.raw++;
    c.normalized += normalize(msg).length;
    const fallback = new Date(); // identity check: returned object === fallback means not parsed
    const t = (msg as { MetaData?: { time_utc?: unknown } }).MetaData?.time_utc;
    if (parseAisstreamTime(t, fallback) === fallback) badTime++;
    counts.set(type, c);
  },
});
client.start();
console.log(`capturing for ${seconds}s -> ${out}`);
setTimeout(() => {
  client.stop();
  file.end();
  console.log(`captured ${total} messages`);
  console.table(Object.fromEntries(counts));
  console.log(`messages with missing/unparseable MetaData.time_utc: ${badTime}` + (badTime ? '  <-- check a captured line and fix parseAisstreamTime' : ''));
  console.log('If a position type normalizes to 0 of its raw count, field names or bbox order are wrong.');
  process.exit(0);
}, seconds * 1000);
