-- Corrected preset outlines after checking them against coastlines:
--  * Strait of Malacca was drawn over the Malay Peninsula; now follows the water between Sumatra and Malaysia.
--  * Strait of Dover and Singapore Strait trimmed to the waterway (less coastline/land inside).
UPDATE zones z
SET geom = ST_Multi(ST_Segmentize(ST_GeomFromText(v.wkt, 4326), 0.1))::geography, updated_at = now()
FROM (VALUES
  ('Strait of Malacca',
   'POLYGON((97.30 5.45, 98.00 6.20, 100.05 6.00, 100.10 5.30, 100.45 4.20, 101.15 2.95, 101.70 2.35, 102.20 2.05, 103.00 1.50, 103.50 1.25, 103.45 1.05, 102.90 1.25, 101.75 1.95, 100.95 2.30, 99.95 3.10, 98.85 3.95, 97.30 5.45))'),
  ('Strait of Dover',
   'POLYGON((0.95 50.85, 1.45 50.65, 1.55 50.75, 1.50 50.88, 1.85 51.00, 2.05 51.10, 1.75 51.25, 1.45 51.20, 1.35 51.08, 1.05 50.95, 0.95 50.85))'),
  ('Singapore Strait',
   'POLYGON((103.55 1.17, 103.75 1.24, 104.10 1.27, 104.45 1.30, 104.45 1.18, 104.10 1.15, 103.75 1.13, 103.55 1.10, 103.55 1.17))')
) AS v(name, wkt)
WHERE z.preset AND z.name = v.name;
