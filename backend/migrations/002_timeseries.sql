-- Position history: native daily range partitions (no TimescaleDB needed, works on Supabase).
-- Partition creation/retention and the 1-minute track rollup are run by the ingestor
-- (src/db/maintenance.ts) via the functions below.

CREATE TABLE vessel_positions (
  ts          timestamptz NOT NULL,
  mmsi        integer NOT NULL,
  geom        geography(Point, 4326) NOT NULL,
  sog         real,
  cog         real,
  heading     smallint,
  rot         smallint,
  nav_status  smallint,
  msg_type    smallint NOT NULL,
  PRIMARY KEY (mmsi, ts)          -- dedupes repeated messages (ON CONFLICT DO NOTHING)
) PARTITION BY RANGE (ts);

-- Catches rows outside the pre-created daily partitions (e.g. very old replays).
CREATE TABLE vessel_positions_default PARTITION OF vessel_positions DEFAULT;

-- Creates daily partitions from `days_back` ago to `days_ahead` days ahead. Idempotent.
CREATE FUNCTION ensure_position_partitions(days_back int DEFAULT 2, days_ahead int DEFAULT 7)
RETURNS int LANGUAGE plpgsql AS $$
DECLARE
  d date;
  name text;
  created int := 0;
BEGIN
  FOR d IN SELECT generate_series(current_date - days_back, current_date + days_ahead, interval '1 day')::date LOOP
    name := format('vessel_positions_%s', to_char(d, 'YYYYMMDD'));
    IF to_regclass(name) IS NULL THEN
      BEGIN
        EXECUTE format('CREATE TABLE %I PARTITION OF vessel_positions FOR VALUES FROM (%L) TO (%L)',
                       name, d::timestamptz, (d + 1)::timestamptz);
        created := created + 1;
      EXCEPTION WHEN check_violation OR invalid_object_definition THEN
        -- The default partition already holds rows for this day; leave them there.
        RAISE NOTICE 'skipping partition % (rows exist in default partition)', name;
      END;
    END IF;
  END LOOP;
  RETURN created;
END $$;

-- Drops whole daily partitions older than the retention window (instant, no vacuum bloat).
CREATE FUNCTION drop_old_position_partitions(retention_days int)
RETURNS int LANGUAGE plpgsql AS $$
DECLARE
  r record;
  dropped int := 0;
  cutoff date := current_date - retention_days;
BEGIN
  FOR r IN
    SELECT c.relname
    FROM pg_inherits i JOIN pg_class c ON c.oid = i.inhrelid
    WHERE i.inhparent = 'vessel_positions'::regclass AND c.relname ~ '^vessel_positions_\d{8}$'
  LOOP
    IF to_date(right(r.relname, 8), 'YYYYMMDD') < cutoff THEN
      EXECUTE format('DROP TABLE %I', r.relname);
      dropped := dropped + 1;
    END IF;
  END LOOP;
  DELETE FROM vessel_positions_default WHERE ts < cutoff;
  RETURN dropped;
END $$;

SELECT ensure_position_partitions(2, 7);

-- 1-minute downsampled tracks for long-range history; kept much longer than raw positions.
CREATE TABLE vessel_tracks_1m (
  mmsi     integer NOT NULL,
  bucket   timestamptz NOT NULL,
  geom     geography(Point, 4326) NOT NULL,   -- last position in the minute
  cog      real,
  sog_avg  real,
  sog_max  real,
  samples  integer NOT NULL,
  PRIMARY KEY (mmsi, bucket)
);
CREATE INDEX vessel_tracks_1m_bucket ON vessel_tracks_1m (bucket);

-- Small key/value table for job watermarks.
CREATE TABLE job_state (
  name   text PRIMARY KEY,
  value  timestamptz NOT NULL
);

-- Rolls raw positions in [from_ts, to_ts) up into 1-minute buckets (upsert, so re-runs are safe).
CREATE FUNCTION refresh_tracks_1m(from_ts timestamptz, to_ts timestamptz)
RETURNS int LANGUAGE sql AS $$
  WITH agg AS (
    SELECT DISTINCT ON (mmsi, bucket)
      mmsi, bucket, geom, cog,
      avg(sog)  OVER w AS sog_avg,
      max(sog)  OVER w AS sog_max,
      count(*)  OVER w AS samples
    FROM (
      SELECT p.*, date_bin(interval '1 minute', p.ts, timestamptz '2000-01-01') AS bucket
      FROM vessel_positions p
      WHERE p.ts >= date_bin(interval '1 minute', from_ts, timestamptz '2000-01-01') AND p.ts < to_ts
    ) x
    WINDOW w AS (PARTITION BY mmsi, bucket)
    ORDER BY mmsi, bucket, ts DESC
  ),
  up AS (
    INSERT INTO vessel_tracks_1m (mmsi, bucket, geom, cog, sog_avg, sog_max, samples)
    SELECT mmsi, bucket, geom, cog, sog_avg, sog_max, samples FROM agg
    ON CONFLICT (mmsi, bucket) DO UPDATE SET
      geom = EXCLUDED.geom, cog = EXCLUDED.cog, sog_avg = EXCLUDED.sog_avg,
      sog_max = EXCLUDED.sog_max, samples = EXCLUDED.samples
    RETURNING 1
  )
  SELECT count(*)::int FROM up
$$;
