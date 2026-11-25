import { pool } from './pool.js';
import { logger } from '../shared/logger.js';

const TRACKS_JOB = 'tracks_1m';
/** Re-aggregate this much before the watermark to absorb late-arriving messages. */
const LATE_DATA_MS = 5 * 60_000;

/** Ensures daily partitions exist and drops expired ones / expired 1-minute tracks. */
export async function partitionMaintenance(opts: { positionsRetentionDays: number; tracksRetentionDays: number }) {
  const { rows } = await pool.query<{ created: number; dropped: number }>(
    `SELECT ensure_position_partitions(2, 7) AS created, drop_old_position_partitions($1) AS dropped`,
    [opts.positionsRetentionDays],
  );
  const del = await pool.query(`DELETE FROM vessel_tracks_1m WHERE bucket < now() - make_interval(days => $1)`, [
    opts.tracksRetentionDays,
  ]);
  const r = { ...rows[0]!, tracks_deleted: del.rowCount ?? 0 };
  if (r.created || r.dropped || r.tracks_deleted) logger.info(r, 'partition maintenance');
}

/** Rolls raw positions up into vessel_tracks_1m, from the stored watermark to (now - 1 minute). */
export async function refreshTracks(): Promise<number> {
  const to = new Date(Math.floor((Date.now() - 60_000) / 60_000) * 60_000); // last complete minute
  const { rows } = await pool.query<{ value: Date }>(`SELECT value FROM job_state WHERE name = $1`, [TRACKS_JOB]);
  const watermark = rows[0]?.value ?? new Date(to.getTime() - 24 * 3600_000);
  const from = new Date(watermark.getTime() - LATE_DATA_MS);
  if (from >= to) return 0;
  const res = await pool.query<{ n: number }>(`SELECT refresh_tracks_1m($1, $2) AS n`, [from, to]);
  await pool.query(
    `INSERT INTO job_state (name, value) VALUES ($1, $2) ON CONFLICT (name) DO UPDATE SET value = EXCLUDED.value`,
    [TRACKS_JOB, to],
  );
  return res.rows[0]!.n;
}

/** Current rollup watermark: buckets before it are materialized in vessel_tracks_1m. */
export async function tracksWatermark(): Promise<Date | null> {
  const { rows } = await pool.query<{ value: Date }>(`SELECT value FROM job_state WHERE name = $1`, [TRACKS_JOB]);
  return rows[0]?.value ?? null;
}

/** Starts periodic jobs; returns a stop function. */
export function startMaintenance(opts: { positionsRetentionDays: number; tracksRetentionDays: number }) {
  const run = (name: string, fn: () => Promise<unknown>) => () =>
    fn().catch((err) => logger.error({ err, job: name }, 'maintenance job failed'));
  const partitions = run('partitions', () => partitionMaintenance(opts));
  const tracks = run('tracks_1m', refreshTracks);
  void partitions();
  const t1 = setInterval(partitions, 3600_000);
  const t2 = setInterval(tracks, 60_000);
  return () => {
    clearInterval(t1);
    clearInterval(t2);
  };
}
