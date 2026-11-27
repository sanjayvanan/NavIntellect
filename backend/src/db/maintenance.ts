import { guardClient, pool } from './pool.js';
import { logger } from '../shared/logger.js';

export const TRACKS_JOB = 'tracks';
/** An hour is packed this long after it ends, so slightly late messages still make it into history. */
const LATENESS_MS = 10 * 60_000;
const HOUR_MS = 3600_000;

export interface MaintenanceOptions {
  rawRetentionHours: number;
  tracksRetentionDays: number;
  latestRetentionDays: number;
  /** Ship static data (vessels) not heard for this long is deleted; at least the other retentions. */
  vesselsRetentionDays?: number;
  dbSizeLimitMb: number;
  /** AI request traces older than this are deleted (default 30 days). */
  aiTraceRetentionDays?: number;
}

/** Packs every closed hour (minus the lateness margin) into vessel_tracks. Returns points packed. */
export async function compactTracks(now = Date.now()): Promise<number> {
  const to = new Date(Math.floor((now - LATENESS_MS) / HOUR_MS) * HOUR_MS);
  const { rows } = await pool.query<{ n: number }>(`SELECT compact_tracks($1) AS n`, [to]);
  return rows[0]!.n;
}

/** Everything before this instant is in vessel_tracks; everything from it on is still raw. */
export async function tracksWatermark(): Promise<Date | null> {
  const { rows } = await pool.query<{ value: Date }>(`SELECT value FROM job_state WHERE name = $1`, [TRACKS_JOB]);
  return rows[0]?.value ?? null;
}

/**
 * Partitions, retention and the storage guard. Raw partitions are only dropped once packed
 * (never past the compaction watermark), so a stalled compaction can't lose history.
 */
export async function storageMaintenance(opts: MaintenanceOptions) {
  const { rows } = await pool.query<{ raw_created: number; tracks_created: number; raw_dropped: number; tracks_dropped: number }>(
    `SELECT ensure_position_partitions(2, 3) AS raw_created,
            ensure_track_partitions(1, 2) AS tracks_created,
            drop_position_partitions_before(least(now() - make_interval(hours => $1),
                                                  COALESCE((SELECT value FROM job_state WHERE name = $3), '-infinity'))) AS raw_dropped,
            drop_track_partitions_before(date_trunc('day', now(), 'UTC') - make_interval(days => $2 - 1)) AS tracks_dropped`,
    [opts.rawRetentionHours, opts.tracksRetentionDays, TRACKS_JOB],
  );
  const del = await pool.query(`DELETE FROM vessel_latest WHERE ts < now() - make_interval(days => $1)`, [opts.latestRetentionDays]);
  const vessels = await pruneVessels(Math.max(opts.vesselsRetentionDays ?? 30, opts.latestRetentionDays, opts.tracksRetentionDays + 1));
  const r = { ...rows[0]!, latest_pruned: del.rowCount ?? 0, vessels_pruned: vessels };
  if (r.raw_created || r.tracks_created || r.raw_dropped || r.tracks_dropped || r.latest_pruned || r.vessels_pruned) logger.info(r, 'storage maintenance');
  await reindexBloated();
  await storageGuard(opts.dbSizeLimitMb);
  // After the guard: a failure here must never skip the size check.
  await pool
    .query(`DELETE FROM ai_requests WHERE created_at < now() - make_interval(days => $1)`, [opts.aiTraceRetentionDays ?? 30])
    .then((t) => t.rowCount && logger.info({ ai_traces_pruned: t.rowCount }, 'old AI traces deleted'))
    .catch((err) => logger.warn({ err: (err as Error).message }, 'could not prune AI traces'));
}

/**
 * Forgets ships not heard for `days` (name, type, size, destination): the list of every ship ever
 * seen otherwise grows forever. Ships still on the live map are kept; a ship that is heard again
 * is simply added back. Deletes in batches so the table is never locked for long.
 */
export async function pruneVessels(days: number): Promise<number> {
  let total = 0;
  for (;;) {
    const { rowCount } = await pool.query(
      `DELETE FROM vessels WHERE mmsi IN (
         SELECT v.mmsi FROM vessels v
         WHERE v.last_seen < now() - make_interval(days => $1)
           AND NOT EXISTS (SELECT 1 FROM vessel_latest l WHERE l.mmsi = v.mmsi)
         LIMIT 5000)`,
      [days],
    );
    total += rowCount ?? 0;
    if ((rowCount ?? 0) < 5000) return total;
  }
}

/**
 * Keep-alive for the Supabase free plan, which pauses a project after a week without database
 * activity: records a write (job_state 'heartbeat:<who>') at start and then once a day, from
 * the API and the ingestor alike, so the database sees activity even when no data is flowing
 * (e.g. the AIS feed is down and nobody opens the map). Returns a stop function.
 */
export function startHeartbeat(who: string, everyMs = 24 * 3600_000) {
  const beat = () =>
    pool
      .query(
        `INSERT INTO job_state (name, value) VALUES ($1, now()) ON CONFLICT (name) DO UPDATE SET value = now()`,
        [`heartbeat:${who}`],
      )
      .catch((err) => logger.warn({ err, who }, 'database heartbeat failed'));
  void beat();
  const t = setInterval(beat, everyMs);
  t.unref();
  return () => clearInterval(t);
}

/**
 * Indexes on vessel_latest, which is rewritten for every position report (each ship's row
 * thousands of times a day). The `ts` index suffers most: every update moves the ship's entry to
 * the newest end, and the half-empty pages left behind are not fully reused, so it grows to
 * ~1 KB per ship (measured: 55 MB for 48k ships, against ~2 MB when rebuilt).
 */
const HOT_INDEXES = ['vessel_latest_ts', 'vessel_latest_geom', 'vessel_latest_pkey'];
/** Rebuild when an index is this many times its table's data and above BLOAT_MIN_MB. */
const BLOAT_RATIO = 3;
const BLOAT_MIN_MB = 8;
const REINDEX_LOCK = 4_242_001; // advisory lock: one rebuild at a time across all servers

/**
 * Rebuilds bloated vessel_latest indexes with REINDEX CONCURRENTLY: reads and writes carry on
 * while it runs. If another server (or an earlier run) holds the lock, it skips this round.
 * Returns the names of the indexes rebuilt.
 */
export async function reindexBloated(opts: { ratio?: number; minMb?: number } = {}): Promise<string[]> {
  const ratio = opts.ratio ?? BLOAT_RATIO;
  const minBytes = (opts.minMb ?? BLOAT_MIN_MB) * 1024 * 1024;
  const client = await pool.connect();
  const unguard = guardClient(client);
  const rebuilt: string[] = [];
  try {
    const { rows: lock } = await client.query<{ ok: boolean }>(`SELECT pg_try_advisory_lock($1) AS ok`, [REINDEX_LOCK]);
    if (!lock[0]!.ok) return rebuilt;
    try {
      const { rows } = await client.query<{ name: string; size: string; heap: string }>(
        `SELECT i.relname AS name, pg_relation_size(i.oid)::text AS size, pg_relation_size(x.indrelid)::text AS heap
         FROM pg_index x JOIN pg_class i ON i.oid = x.indexrelid
         WHERE x.indrelid = 'vessel_latest'::regclass AND i.relname = ANY($1)`,
        [HOT_INDEXES],
      );
      for (const r of rows) {
        const size = Number(r.size);
        if (size < minBytes || size < Number(r.heap) * ratio) continue;
        const t0 = Date.now();
        await client.query(`REINDEX INDEX CONCURRENTLY ${quoteIndex(r.name)}`);
        const { rows: after } = await client.query<{ size: string }>(`SELECT pg_relation_size($1::regclass)::text AS size`, [r.name]);
        logger.info({ index: r.name, beforeMb: +(size / 1048576).toFixed(1), afterMb: +(Number(after[0]!.size) / 1048576).toFixed(1), ms: Date.now() - t0 }, 'rebuilt bloated index');
        rebuilt.push(r.name);
      }
    } finally {
      await client.query(`SELECT pg_advisory_unlock($1)`, [REINDEX_LOCK]);
    }
  } finally {
    unguard();
    client.release();
  }
  return rebuilt;
}

function quoteIndex(name: string) {
  if (!HOT_INDEXES.includes(name)) throw new Error(`unexpected index ${name}`);
  return `"${name}"`;
}

/**
 * Keeps the database under its plan limit (Supabase makes an over-limit database read-only):
 * above 85 % of the limit, drops the oldest past day of packed tracks (never today's or future days).
 */
export async function storageGuard(limitMb: number): Promise<number> {
  let dropped = 0;
  for (;;) {
    const { rows } = await pool.query<{ size: string; oldest: string | null }>(
      `SELECT pg_database_size(current_database())::text AS size,
              (SELECT relname FROM track_partitions() WHERE day < date_trunc('day', now(), 'UTC') ORDER BY day LIMIT 1) AS oldest`,
    );
    const { size, oldest } = rows[0]!;
    const sizeMb = Number(size) / 1024 / 1024;
    if (sizeMb < limitMb * 0.85) return dropped;
    if (!oldest) {
      logger.warn({ sizeMb: Math.round(sizeMb), limitMb }, 'database near its size limit; only today\'s tracks left, nothing dropped');
      return dropped;
    }
    logger.warn({ sizeMb: Math.round(sizeMb), limitMb, partition: oldest }, 'storage guard: dropping oldest track day');
    await pool.query(`DROP TABLE ${quoteIdent(oldest)}`);
    dropped++;
  }
}

function quoteIdent(name: string) {
  if (!/^vessel_tracks_\d{8}$/.test(name)) throw new Error(`unexpected partition name ${name}`);
  return `"${name}"`;
}

/** Starts periodic jobs; returns a stop function. */
export function startMaintenance(opts: MaintenanceOptions) {
  const run = (name: string, fn: () => Promise<unknown>) => () =>
    fn().catch((err) => logger.error({ err, job: name }, 'maintenance job failed'));
  // Compaction first, so raw partitions it still needs are never dropped before it ran.
  const cycle = run('storage', async () => {
    const t0 = Date.now();
    const packed = await compactTracks();
    if (packed) logger.info({ packed, ms: Date.now() - t0 }, 'tracks compacted');
    await storageMaintenance(opts);
  });
  void cycle();
  const t = setInterval(cycle, 10 * 60_000);
  return () => clearInterval(t);
}
