import 'dotenv/config';
import { z } from 'zod';

const bool = z
  .enum(['true', 'false', '1', '0'])
  .transform((v) => v === 'true' || v === '1');

// [[[lat, lon], [lat, lon]], ...] — aisstream uses latitude first.
const bboxes = z
  .string()
  .transform((s) => JSON.parse(s) as unknown)
  .pipe(z.array(z.tuple([z.tuple([z.number(), z.number()]), z.tuple([z.number(), z.number()])])).min(1));

const schema = z.object({
  NODE_ENV: z.string().default('development'),
  LOG_LEVEL: z.string().default('info'),

  AISSTREAM_API_KEY: z.string().default(''),
  AIS_BBOXES: bboxes.default([
    [[5.0, 65.0], [25.5, 78.0]],
    [[5.0, 78.0], [23.0, 95.0]],
  ]),

  // Supabase: use the *Session pooler* URI (IPv4, supports session state). Not the transaction pooler (:6543).
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required (Supabase → Connect → Session pooler)'),
  DATABASE_SSL: z.enum(['auto', 'true', 'false']).default('auto'),
  DATABASE_SSL_CA: z.string().optional(),
  DATABASE_POOL_MAX: z.coerce.number().int().positive().default(5),
  DB_SCHEMA: z.string().default('ais'),
  POSITIONS_RETENTION_DAYS: z.coerce.number().int().positive().default(90),
  TRACKS_RETENTION_DAYS: z.coerce.number().int().positive().default(365),
  REDIS_URL: z.string().default('redis://localhost:6379'),

  PORT: z.coerce.number().int().default(3000),
  HOST: z.string().default('0.0.0.0'),
  CORS_ORIGIN: z.string().default('http://localhost:5173'),
  AUTH_REQUIRED_FOR_READS: bool.default(false),
  JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 characters'),
  ACCESS_TOKEN_TTL: z.string().default('15m'),
  REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().positive().default(14),

  FLUSH_INTERVAL_MS: z.coerce.number().int().positive().default(1000),
  FLUSH_MAX_ROWS: z.coerce.number().int().positive().default(2000),
  MAX_BUFFER: z.coerce.number().int().positive().default(50000),
  AIS_GAP_MINUTES: z.coerce.number().positive().default(30),
  ALERT_COOLDOWN_MINUTES: z.coerce.number().nonnegative().default(15),

  ADMIN_EMAIL: z.string().optional(),
  ADMIN_PASSWORD: z.string().optional(),
});

export type Config = z.infer<typeof schema>;

function load(): Config {
  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  ${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Invalid configuration:\n${issues}`);
  }
  return parsed.data;
}

export const config = load();
