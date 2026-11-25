-- Self-service accounts and per-user settings that follow the user across devices.
ALTER TABLE users ADD COLUMN display_name text CHECK (char_length(display_name) <= 80);

-- One JSON document per user: theme, map view (center/zoom), base layer, overlays, ship display
-- options... The client owns the shape (validated loosely by the API) so new settings need no migration.
CREATE TABLE user_preferences (
  user_id     uuid PRIMARY KEY REFERENCES users (id) ON DELETE CASCADE,
  settings    jsonb NOT NULL DEFAULT '{}' CHECK (jsonb_typeof(settings) = 'object'),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
