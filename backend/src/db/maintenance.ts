import { pool } from './pool.js';
import { logger } from '../shared/logger.js';

export const TRACKS_JOB = 'tracks';
/** An hour is packed this long after it ends, so slightly late messages still make it into history. */
const LATENESS_MS = 10 * 60_000;
const HOUR_MS = 3600_000;

export interface MaintenanceOptions {
  rawRetentionHours: number;
  tracksRetentionDays: number;
  latestRetentionDays: number;
  dbSizeLimitMb: number;
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
  const r = { ...rows[0]!, latest_pruned: del.rowCount ?? 0 };
  if (r.raw_created || r.tracks_created || r.raw_dropped || r.tracks_dropped || r.latest_pruned) logger.info(r, 'storage maintenance');
  await storageGuard(opts.dbSizeLimitMb);
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
