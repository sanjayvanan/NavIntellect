-- Worldwide history on a small database (Supabase free tier = 500 MB).
--
-- Two tiers:
--   vessel_positions  raw, one row per message, HOURLY partitions, kept only a few hours (hot tail).
--   vessel_tracks     one row per vessel per 6-hour block, points packed into bytea (16 B/point),
--                     DAILY partitions, kept TRACKS_RETENTION_DAYS. ~7x smaller than raw rows.
-- Every closed hour is appended to its block exactly once by compact_tracks() (watermark in job_state).
-- Point encoding (big-endian, 16 bytes):
--   int2 seconds since block start | int4 lat*1e6 | int4 lon*1e6 | int2 sog*10 | int2 cog*10 | int2 heading
--   (-1 = not available for sog/cog/heading)
-- All time bucketing is done in UTC, independent of the session time zone.

DROP FUNCTION IF EXISTS refresh_tracks_1m(timestamptz, timestamptz);
DROP TABLE IF EXISTS vessel_tracks_1m;
DELETE FROM job_state WHERE name = 'tracks_1m';
DROP FUNCTION IF EXISTS ensure_position_partitions(int, int);
DROP FUNCTION IF EXISTS drop_old_position_partitions(int);
DROP TABLE IF EXISTS vessel_positions CASCADE;

-- ---------------------------------------------------------------- raw tier
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
  PRIMARY KEY (mmsi, ts)
) PARTITION BY RANGE (ts);
CREATE TABLE vessel_positions_default PARTITION OF vessel_positions DEFAULT;

-- ---------------------------------------------------------------- packed tier
CREATE TABLE vessel_tracks (
  mmsi         integer NOT NULL,
  block_start  timestamptz NOT NULL,          -- 6-hour aligned (UTC)
  n            integer NOT NULL,              -- number of points
  min_lat      real NOT NULL,
  min_lon      real NOT NULL,
  max_lat      real NOT NULL,
  max_lon      real NOT NULL,
  pts          bytea NOT NULL,
  PRIMARY KEY (mmsi, block_start)
) PARTITION BY RANGE (block_start);
ALTER TABLE vessel_tracks ALTER COLUMN pts SET STORAGE EXTERNAL;  -- coordinates don't compress; skip pglz
CREATE TABLE vessel_tracks_default PARTITION OF vessel_tracks DEFAULT;
-- "Which vessels were in this area?" -> block bounding boxes, then exact point check.
CREATE INDEX vessel_tracks_box ON vessel_tracks USING gist (box(point(min_lon, min_lat), point(max_lon, max_lat)));

CREATE FUNCTION utc_hour(t timestamptz) RETURNS timestamptz
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$ SELECT date_trunc('hour', t, 'UTC') $$;

CREATE FUNCTION track_block(t timestamptz) RETURNS timestamptz
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT date_trunc('day', t, 'UTC') + make_interval(hours => (extract(hour FROM t AT TIME ZONE 'UTC')::int / 6) * 6)
$$;

-- ---------------------------------------------------------------- partition management
-- Hourly raw partitions from `hours_back` to `hours_ahead` around now. Idempotent.
CREATE FUNCTION ensure_position_partitions(hours_back int DEFAULT 2, hours_ahead int DEFAULT 3)
RETURNS int LANGUAGE plpgsql AS $$
DECLARE
  h timestamptz;
  name text;
  created int := 0;
BEGIN
  FOR h IN SELECT generate_series(utc_hour(now()) - make_interval(hours => hours_back),
                                  utc_hour(now()) + make_interval(hours => hours_ahead), interval '1 hour') LOOP
    name := format('vessel_positions_%s', to_char(h AT TIME ZONE 'UTC', 'YYYYMMDDHH24'));
    IF to_regclass(name) IS NULL THEN
      BEGIN
        EXECUTE format('CREATE TABLE %I PARTITION OF vessel_positions FOR VALUES FROM (%L) TO (%L)',
                       name, h, h + interval '1 hour');
        created := created + 1;
      EXCEPTION WHEN check_violation OR invalid_object_definition THEN
        RAISE NOTICE 'skipping partition % (rows exist in default partition)', name;
      END;
    END IF;
  END LOOP;
  RETURN created;
END $$;

-- Drops raw hourly partitions that ended before `cutoff`. Callers pass min(now - retention, compaction watermark).
CREATE FUNCTION drop_position_partitions_before(cutoff timestamptz)
RETURNS int LANGUAGE plpgsql AS $$
DECLARE
  r record;
  dropped int := 0;
BEGIN
  FOR r IN
    SELECT c.relname
    FROM pg_inherits i JOIN pg_class c ON c.oid = i.inhrelid
    WHERE i.inhparent = 'vessel_positions'::regclass AND c.relname ~ '^vessel_positions_\d{10}$'
  LOOP
    IF (to_date(substr(r.relname, 18, 8), 'YYYYMMDD') + make_interval(hours => right(r.relname, 2)::int))::timestamp
       AT TIME ZONE 'UTC' + interval '1 hour' <= cutoff THEN
      EXECUTE format('DROP TABLE %I', r.relname);
      dropped := dropped + 1;
    END IF;
  END LOOP;
  DELETE FROM vessel_positions_default WHERE ts < cutoff;
  RETURN dropped;
END $$;

-- Daily packed-track partitions from `days_back` to `days_ahead`. Idempotent.
CREATE FUNCTION ensure_track_partitions(days_back int DEFAULT 1, days_ahead int DEFAULT 2)
RETURNS int LANGUAGE plpgsql AS $$
DECLARE
  d timestamptz;
  name text;
  created int := 0;
BEGIN
  FOR d IN SELECT generate_series(date_trunc('day', now(), 'UTC') - make_interval(days => days_back),
                                  date_trunc('day', now(), 'UTC') + make_interval(days => days_ahead), interval '1 day') LOOP
    name := format('vessel_tracks_%s', to_char(d AT TIME ZONE 'UTC', 'YYYYMMDD'));
    IF to_regclass(name) IS NULL THEN
      BEGIN
        EXECUTE format('CREATE TABLE %I PARTITION OF vessel_tracks FOR VALUES FROM (%L) TO (%L)',
                       name, d, d + interval '1 day');
        created := created + 1;
      EXCEPTION WHEN check_violation OR invalid_object_definition THEN
        RAISE NOTICE 'skipping partition % (rows exist in default partition)', name;
      END;
    END IF;
  END LOOP;
  RETURN created;
END $$;

-- Daily track partitions, oldest first (used for retention and the storage guard).
CREATE FUNCTION track_partitions()
RETURNS TABLE (relname text, day timestamptz, bytes bigint) LANGUAGE sql STABLE AS $$
  SELECT c.relname::text, (to_date(right(c.relname, 8), 'YYYYMMDD')::timestamp AT TIME ZONE 'UTC'),
         pg_total_relation_size(c.oid)
  FROM pg_inherits i JOIN pg_class c ON c.oid = i.inhrelid
  WHERE i.inhparent = 'vessel_tracks'::regclass AND c.relname ~ '^vessel_tracks_\d{8}$'
  ORDER BY 2
$$;

CREATE FUNCTION drop_track_partitions_before(cutoff timestamptz)
RETURNS int LANGUAGE plpgsql AS $$
DECLARE
  r record;
  dropped int := 0;
BEGIN
  FOR r IN SELECT * FROM track_partitions() WHERE day + interval '1 day' <= cutoff LOOP
    EXECUTE format('DROP TABLE %I', r.relname);
    dropped := dropped + 1;
  END LOOP;
  DELETE FROM vessel_tracks_default WHERE block_start < cutoff - interval '6 hours';
  RETURN dropped;
END $$;

-- ---------------------------------------------------------------- packing
-- Appends raw positions with ts in [watermark, to_ts) to their 6-hour blocks, then advances the
-- watermark, in one statement (so each hour is packed exactly once). to_ts must be hour-aligned.
-- Returns the number of points packed.
CREATE FUNCTION compact_tracks(to_ts timestamptz)
RETURNS int LANGUAGE plpgsql AS $$
DECLARE
  wm timestamptz;
  packed int;
BEGIN
  SELECT value INTO wm FROM job_state WHERE name = 'tracks' FOR UPDATE;
  IF wm IS NULL THEN
    SELECT utc_hour(min(ts)) INTO wm FROM vessel_positions;
    IF wm IS NULL THEN RETURN 0; END IF;
    INSERT INTO job_state (name, value) VALUES ('tracks', wm) ON CONFLICT (name) DO NOTHING;
  END IF;
  IF to_ts <= wm THEN RETURN 0; END IF;

  WITH p AS (
    SELECT mmsi, ts, track_block(ts) AS blk,
           ST_Y(geom::geometry) AS lat, ST_X(geom::geometry) AS lon, sog, cog, heading
    FROM vessel_positions
    WHERE ts >= wm AND ts < to_ts
  ),
  agg AS (
    SELECT mmsi, blk, count(*) AS n,
           min(lat) AS min_lat, min(lon) AS min_lon, max(lat) AS max_lat, max(lon) AS max_lon,
           string_agg(
             int2send(floor(extract(epoch FROM ts - blk))::int2)
             || int4send(round(lat * 1e6)::int4)
             || int4send(round(lon * 1e6)::int4)
             || int2send(COALESCE(round(sog * 10), -1)::int2)
             || int2send(COALESCE(round(cog * 10), -1)::int2)
             || int2send(COALESCE(heading, -1)::int2),
             ''::bytea ORDER BY ts) AS pts
    FROM p GROUP BY mmsi, blk
  ),
  up AS (  -- data-modifying CTE: always executed
    INSERT INTO vessel_tracks AS t (mmsi, block_start, n, min_lat, min_lon, max_lat, max_lon, pts)
    SELECT mmsi, blk, n, min_lat, min_lon, max_lat, max_lon, pts FROM agg
    ON CONFLICT (mmsi, block_start) DO UPDATE SET
      n       = t.n + EXCLUDED.n,
      min_lat = least(t.min_lat, EXCLUDED.min_lat),
      min_lon = least(t.min_lon, EXCLUDED.min_lon),
      max_lat = greatest(t.max_lat, EXCLUDED.max_lat),
      max_lon = greatest(t.max_lon, EXCLUDED.max_lon),
      pts     = t.pts || EXCLUDED.pts
  )
  SELECT COALESCE(sum(n), 0)::int INTO packed FROM agg;

  UPDATE job_state SET value = to_ts WHERE name = 'tracks';
  RETURN packed;
END $$;

-- ---------------------------------------------------------------- unpacking
CREATE FUNCTION bytea_i16(b bytea, off int) RETURNS int
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT CASE WHEN v >= 32768 THEN v - 65536 ELSE v END
  FROM (SELECT get_byte(b, off) * 256 + get_byte(b, off + 1) AS v) x
$$;

CREATE FUNCTION bytea_i32(b bytea, off int) RETURNS int
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT ('x' || encode(substring(b FROM off + 1 FOR 4), 'hex'))::bit(32)::int4
$$;

-- Decodes one packed block into points. Usable directly from SQL (analytics, AI tools):
--   SELECT p.* FROM vessel_tracks t, track_points(t.pts, t.block_start) p WHERE t.mmsi = 419000123;
CREATE FUNCTION track_points(pts bytea, block_start timestamptz)
RETURNS TABLE (ts timestamptz, lat double precision, lon double precision, sog real, cog real, heading smallint)
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT block_start + make_interval(secs => bytea_i16(pts, o)),
         (bytea_i32(pts, o + 2) / 1e6)::float8,
         (bytea_i32(pts, o + 6) / 1e6)::float8,
         (NULLIF(bytea_i16(pts, o + 10), -1) / 10.0)::real,
         (NULLIF(bytea_i16(pts, o + 12), -1) / 10.0)::real,
         NULLIF(bytea_i16(pts, o + 14), -1)::smallint
  FROM generate_series(0, length(pts) / 16 - 1) AS i, LATERAL (SELECT i * 16 AS o) x
$$;

-- ---------------------------------------------------------------- search indexes
CREATE INDEX vessels_callsign_trgm ON vessels USING gin (callsign gin_trgm_ops);
CREATE INDEX vessels_mmsi_text ON vessels ((mmsi::text) text_pattern_ops);
CREATE INDEX vessels_imo_text ON vessels ((imo::text) text_pattern_ops) WHERE imo IS NOT NULL;

SELECT ensure_position_partitions(2, 3);
SELECT ensure_track_partitions(1, 2);
