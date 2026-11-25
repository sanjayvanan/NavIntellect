-- Core extensions and vessel identity / live state.
-- Extensions go in `extensions` (Supabase's convention; created here for plain Postgres).
-- Tables are created in the app schema (DB_SCHEMA, default `ais`) via search_path.
CREATE SCHEMA IF NOT EXISTS extensions;
CREATE EXTENSION IF NOT EXISTS postgis  WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS pg_trgm  WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS citext   WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;

-- Static identity, one row per MMSI. MMSI fits in int4 (max 999,999,999),
-- which also keeps it a JS number when read through node-pg.
CREATE TABLE vessels (
  mmsi               integer PRIMARY KEY CHECK (mmsi > 0 AND mmsi <= 999999999),
  uuid               uuid NOT NULL UNIQUE DEFAULT gen_random_uuid(),
  imo                integer,
  name               text,
  callsign           text,
  ship_type          smallint,
  ship_type_label    text,
  dim_a              smallint,
  dim_b              smallint,
  dim_c              smallint,
  dim_d              smallint,
  draught            real,
  destination        text,
  eta                timestamptz,
  first_seen         timestamptz NOT NULL DEFAULT now(),
  last_seen          timestamptz NOT NULL DEFAULT now(),
  static_updated_at  timestamptz
);
CREATE INDEX vessels_name_trgm ON vessels USING gin (name gin_trgm_ops);
CREATE INDEX vessels_imo ON vessels (imo) WHERE imo IS NOT NULL;

-- Hot table: latest position per vessel. This is what the live map reads.
CREATE TABLE vessel_latest (
  mmsi        integer PRIMARY KEY REFERENCES vessels (mmsi) ON DELETE CASCADE,
  ts          timestamptz NOT NULL,                -- sensor (AIS) time
  lat         double precision NOT NULL,
  lon         double precision NOT NULL,
  geom        geography(Point, 4326) NOT NULL,
  sog         real,
  cog         real,
  heading     smallint,
  rot         smallint,
  nav_status  smallint,
  msg_type    smallint NOT NULL,
  updated_at  timestamptz NOT NULL DEFAULT now()  -- ingest (wall clock) time
);
CREATE INDEX vessel_latest_ts   ON vessel_latest (ts DESC);
CREATE INDEX vessel_latest_geom ON vessel_latest USING gist (geom);
