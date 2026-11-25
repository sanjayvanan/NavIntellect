-- User map annotations: pins today; routes/labels later are new `kind` values, not new tables.
-- Same ownership scopes as zones: owner_id NULL = shared (operators), otherwise personal.
CREATE TABLE annotations (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind         text NOT NULL CHECK (kind IN ('pin')),
  geom         geography(Geometry, 4326) NOT NULL
               CHECK (GeometryType(geom::geometry) IN ('POINT', 'LINESTRING')),
  name         text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 120),
  description  text CHECK (char_length(description) <= 1000),
  style        jsonb NOT NULL DEFAULT '{}' CHECK (jsonb_typeof(style) = 'object'),
  properties   jsonb NOT NULL DEFAULT '{}' CHECK (jsonb_typeof(properties) = 'object'),
  owner_id     uuid REFERENCES users (id) ON DELETE CASCADE,
  created_by   uuid REFERENCES users (id) ON DELETE SET NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX annotations_geom  ON annotations USING gist (geom);                -- distance / containment queries
CREATE INDEX annotations_geom_planar ON annotations USING gist ((geom::geometry)); -- viewport (lon/lat box) queries
CREATE INDEX annotations_owner ON annotations (owner_id);
CREATE INDEX annotations_kind  ON annotations (kind);
