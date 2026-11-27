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
  // [[lat, lon], [lat, lon]] corners; default is the whole world.
  AIS_BBOXES: bboxes.default([
    [[-90, -180], [90, 180]],
  ]),

  // Supabase: use the *Session pooler* URI (IPv4, supports session state). Not the transaction pooler (:6543).
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required (Supabase → Connect → Session pooler)'),
  DATABASE_SSL: z.enum(['auto', 'true', 'false']).default('auto'),
  DATABASE_SSL_CA: z.string().optional(),
  DATABASE_POOL_MAX: z.coerce.number().int().positive().default(5),
  DB_SCHEMA: z.string().default('ais'),
  /** Raw per-message rows (hot tail). Packed into vessel_tracks hourly, then dropped. */
  RAW_RETENTION_HOURS: z.coerce.number().int().min(2).default(3),
  /** Packed track history. ~3 days of worldwide AIS fits the 500 MB Supabase free tier. */
  TRACKS_RETENTION_DAYS: z.coerce.number().int().positive().default(3),
  /** Ships not heard from in this long disappear from the live map (static data is kept). */
  LATEST_RETENTION_DAYS: z.coerce.number().int().positive().default(7),
  /** Ships (name, type, size…) not heard for this many days are forgotten (they come back when heard). */
  VESSELS_RETENTION_DAYS: z.coerce.number().int().positive().default(30),
  /** Database plan limit; above 85 % the oldest track day is dropped (Supabase free tier = 500). */
  DB_SIZE_LIMIT_MB: z.coerce.number().int().positive().default(500),
  /** History sampling: at most one stored point per vessel per N seconds (0 = keep every message). */
  POSITIONS_SAMPLE_SECONDS: z.coerce.number().int().min(0).default(120),
  /** Also store a point when a moving ship's course changes this much (degrees; 0 = off). */
  POSITIONS_TURN_DEGREES: z.coerce.number().min(0).max(180).default(20),
  REDIS_URL: z.string().default('redis://localhost:6379'),

  PORT: z.coerce.number().int().default(3000),
  HOST: z.string().default('0.0.0.0'),
  CORS_ORIGIN: z.string().default('http://localhost:5173'),
  AUTH_REQUIRED_FOR_READS: bool.default(false),
  ALLOW_REGISTRATION: bool.default(true), // self-service sign-up (always as viewer)
  JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 characters'),
  ACCESS_TOKEN_TTL: z.string().default('15m'),
  REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().positive().default(14),

  FLUSH_INTERVAL_MS: z.coerce.number().int().positive().default(1000),
  FLUSH_MAX_ROWS: z.coerce.number().int().positive().default(2000),
  MAX_BUFFER: z.coerce.number().int().positive().default(50000),
  AIS_GAP_MINUTES: z.coerce.number().positive().default(30),
  ALERT_COOLDOWN_MINUTES: z.coerce.number().nonnegative().default(15),

  // AI copilot (Gemini). Without a key the AI features are switched off; the rest works as before.
  GEMINI_API_KEY: z.string().default(''),
  /** Fast, cheap stable model; change it here when Google retires it (see docs/AI_FEATURES.md). */
  GEMINI_MODEL: z.string().default('gemini-3.5-flash-lite'),
  /**
   * Free-tier budget, counted in Gemini requests (one copilot question = 1-4 requests).
   * Set these at or below your project's limits shown in Google AI Studio (aistudio.google.com/rate-limit).
   */
  AI_DAILY_LIMIT: z.coerce.number().int().min(1).default(100),
  AI_USER_DAILY_LIMIT: z.coerce.number().int().min(1).default(30),
  AI_RPM: z.coerce.number().int().min(1).default(8),
  /** Tool rounds per question before the model must answer (each round is one more request). */
  AI_MAX_TOOL_ROUNDS: z.coerce.number().int().min(1).max(5).default(3),
  /**
   * List prices in US$ per million tokens, used to show what the AI would cost on the paid tier
   * (the free tier is billed $0). Set them to your model's prices from ai.google.dev/pricing.
   */
  AI_PRICE_INPUT_PER_M: z.coerce.number().min(0).default(0.1),
  AI_PRICE_OUTPUT_PER_M: z.coerce.number().min(0).default(0.4),
  /** AI request traces (ai_requests) are kept this many days. */
  AI_TRACE_RETENTION_DAYS: z.coerce.number().int().positive().default(30),

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
