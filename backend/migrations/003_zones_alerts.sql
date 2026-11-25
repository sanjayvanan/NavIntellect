-- Geofences, presence state and alerts.
CREATE TYPE zone_kind      AS ENUM ('restricted', 'monitoring', 'port', 'anchorage');
CREATE TYPE alert_type     AS ENUM ('zone_enter', 'zone_exit', 'loitering', 'speeding', 'ais_gap');
CREATE TYPE alert_severity AS ENUM ('info', 'warning', 'critical');

CREATE TABLE zones (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text NOT NULL,
  kind        zone_kind NOT NULL DEFAULT 'monitoring',
  geom        geography(MultiPolygon, 4326) NOT NULL,
  -- e.g. {"alert_on_enter": true, "alert_on_exit": true, "max_speed": 8, "loiter_minutes": 30}
  rules       jsonb NOT NULL DEFAULT '{}'::jsonb,
  active      boolean NOT NULL DEFAULT true,
  created_by  uuid,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX zones_geom ON zones USING gist (geom);
CREATE INDEX zones_active ON zones (active);

-- Which vessel is currently inside which zone; drives enter/exit/loiter/gap detection.
CREATE TABLE zone_presence (
  zone_id         uuid NOT NULL REFERENCES zones (id) ON DELETE CASCADE,
  mmsi            integer NOT NULL,
  entered_at      timestamptz NOT NULL,
  last_seen_at    timestamptz NOT NULL,
  slow_since      timestamptz,                  -- set while SOG < 0.5 kn
  loiter_alerted  boolean NOT NULL DEFAULT false,
  gap_alerted     boolean NOT NULL DEFAULT false,
  PRIMARY KEY (zone_id, mmsi)
);
CREATE INDEX zone_presence_mmsi ON zone_presence (mmsi);

CREATE TABLE alerts (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  type             alert_type NOT NULL,
  severity         alert_severity NOT NULL,
  mmsi             integer NOT NULL,
  zone_id          uuid REFERENCES zones (id) ON DELETE SET NULL,
  geom             geography(Point, 4326),
  details          jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at       timestamptz NOT NULL DEFAULT now(),
  acknowledged_by  uuid,
  acknowledged_at  timestamptz
);
CREATE INDEX alerts_created_at ON alerts (created_at DESC);
CREATE INDEX alerts_open       ON alerts (created_at DESC) WHERE acknowledged_at IS NULL;
CREATE INDEX alerts_dedupe     ON alerts (type, mmsi, zone_id, created_at DESC);
