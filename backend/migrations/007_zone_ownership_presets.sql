-- Personal vs shared geofences, display attributes, and well-known maritime zones as presets.
--   owner_id NULL  -> shared zone: visible to everyone, managed by operators/admins
--   owner_id = user -> personal zone: visible to and managed by that user only
ALTER TABLE zones
  ADD COLUMN owner_id    uuid REFERENCES users (id) ON DELETE CASCADE,
  ADD COLUMN color       text CHECK (color ~ '^#[0-9a-fA-F]{6}$'),
  ADD COLUMN description text CHECK (char_length(description) <= 500),
  ADD COLUMN preset      boolean NOT NULL DEFAULT false;
CREATE INDEX zones_owner ON zones (owner_id);

-- Presets: shared reference zones, monitoring (alerts) OFF until an operator switches it on.
-- Outlines are approximate (a few nm), drawn generously around the traffic lanes.
INSERT INTO zones (name, kind, geom, rules, active, color, description, preset)
SELECT name, kind::zone_kind, ST_Multi(ST_GeomFromText(wkt, 4326))::geography, '{}'::jsonb, false, color, description, true
FROM (VALUES
  ('Strait of Hormuz', 'monitoring', '#e53935',
   'Chokepoint between the Persian Gulf and the Gulf of Oman; about a fifth of world oil passes here. Approximate outline.',
   'POLYGON((55.60 26.20, 56.00 26.62, 56.50 26.98, 57.05 26.65, 57.05 25.80, 56.60 25.90, 56.45 26.30, 56.10 26.12, 55.60 26.20))'),
  ('Bab-el-Mandeb', 'monitoring', '#d81b60',
   'Strait between Yemen and Djibouti/Eritrea linking the Red Sea and the Gulf of Aden. Approximate outline.',
   'POLYGON((43.10 12.35, 43.70 12.35, 43.70 12.95, 43.10 12.95, 43.10 12.35))'),
  ('Gulf of Aden IRTC', 'monitoring', '#8e24aa',
   'Internationally Recommended Transit Corridor (anti-piracy lanes). Approximate outline.',
   'POLYGON((45.00 11.70, 53.00 14.20, 53.00 14.45, 45.00 11.95, 45.00 11.70))'),
  ('Suez Canal', 'monitoring', '#fb8c00',
   'Port Said to Suez, including the Bitter Lakes. Approximate outline.',
   'POLYGON((32.24 31.36, 32.42 31.36, 32.40 30.62, 32.52 30.36, 32.62 29.90, 32.50 29.87, 32.30 30.30, 32.24 30.62, 32.24 31.36))'),
  ('Strait of Malacca', 'monitoring', '#00897b',
   'Main shipping lane between Sumatra and the Malay Peninsula. Approximate outline.',
   'POLYGON((97.80 5.20, 99.00 6.00, 100.90 3.60, 102.50 2.50, 103.50 1.50, 103.20 1.00, 102.00 1.90, 100.20 3.00, 97.80 5.20))'),
  ('Singapore Strait', 'monitoring', '#00acc1',
   'Traffic separation scheme south of Singapore. Approximate outline.',
   'POLYGON((103.55 1.05, 104.45 1.05, 104.45 1.32, 103.55 1.32, 103.55 1.05))'),
  ('Panama Canal', 'monitoring', '#43a047',
   'Colón (Caribbean) to Balboa (Pacific), including Gatun Lake. Approximate outline.',
   'POLYGON((-79.98 8.85, -79.45 8.85, -79.45 9.42, -79.98 9.42, -79.98 8.85))'),
  ('Strait of Dover', 'monitoring', '#3949ab',
   'Dover Strait traffic separation scheme, the world''s busiest shipping lane. Approximate outline.',
   'POLYGON((1.00 50.75, 1.50 50.65, 2.00 51.00, 1.75 51.25, 1.35 51.10, 1.00 50.75))'),
  ('Strait of Gibraltar', 'monitoring', '#5e35b1',
   'Entrance to the Mediterranean between Spain and Morocco. Approximate outline.',
   'POLYGON((-6.00 35.85, -5.30 35.85, -5.30 36.15, -6.00 36.15, -6.00 35.85))'),
  ('Bosphorus', 'monitoring', '#6d4c41',
   'Istanbul Strait between the Black Sea and the Sea of Marmara. Approximate outline.',
   'POLYGON((28.97 41.00, 29.06 40.99, 29.16 41.19, 29.12 41.24, 29.04 41.12, 28.98 41.04, 28.97 41.00))'),
  ('Palk Strait', 'monitoring', '#f4511e',
   'Between Tamil Nadu (India) and northern Sri Lanka. Approximate outline.',
   'POLYGON((79.40 9.60, 80.30 9.60, 80.30 10.35, 79.40 10.35, 79.40 9.60))'),
  ('Mumbai Port approaches', 'port', '#1e88e5',
   'Mumbai harbour and JNPT approaches. Approximate outline.',
   'POLYGON((72.75 18.85, 72.98 18.85, 72.98 19.00, 72.75 19.00, 72.75 18.85))')
) AS p(name, kind, color, description, wkt);
