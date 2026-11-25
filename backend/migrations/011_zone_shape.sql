-- How a zone was drawn. The geometry is always a (Multi)Polygon; `shape` says whether the user
-- drew a free polygon, a rectangle or a circle, and `shape_meta` keeps the figures that describe
-- it (polygon: corners; rectangle: width_nm/height_nm; circle: radius_nm, center [lng, lat]).
ALTER TABLE zones
  ADD COLUMN shape      text  NOT NULL DEFAULT 'polygon' CHECK (shape IN ('polygon', 'rectangle', 'circle')),
  ADD COLUMN shape_meta jsonb NOT NULL DEFAULT '{}' CHECK (jsonb_typeof(shape_meta) = 'object');

-- Presets drawn as lon/lat boxes are rectangles: size measured across the middle of the box.
UPDATE zones z
SET shape = 'rectangle',
    shape_meta = jsonb_build_object(
      'width_nm',  round((ST_Distance(ST_MakePoint(b.x1, b.ym)::geography, ST_MakePoint(b.x2, b.ym)::geography) / 1852)::numeric, 2),
      'height_nm', round((ST_Distance(ST_MakePoint(b.xm, b.y1)::geography, ST_MakePoint(b.xm, b.y2)::geography) / 1852)::numeric, 2))
FROM (
  SELECT id, ST_XMin(g) AS x1, ST_XMax(g) AS x2, ST_YMin(g) AS y1, ST_YMax(g) AS y2,
         (ST_XMin(g) + ST_XMax(g)) / 2 AS xm, (ST_YMin(g) + ST_YMax(g)) / 2 AS ym
  FROM (SELECT id, geom::geometry AS g FROM zones) s
) b
WHERE z.id = b.id AND z.preset
  AND z.name IN ('Bab-el-Mandeb', 'Panama Canal', 'Strait of Gibraltar', 'Palk Strait', 'Mumbai Port approaches');

-- Other presets: free polygons; record the corners they were outlined with (before densifying).
UPDATE zones z
SET shape_meta = jsonb_build_object('corners', c.corners)
FROM (VALUES
  ('Strait of Hormuz', 8), ('Gulf of Aden IRTC', 4), ('Suez Canal', 8), ('Strait of Malacca', 16),
  ('Singapore Strait', 8), ('Strait of Dover', 10), ('Bosphorus', 6)
) AS c(name, corners)
WHERE z.preset AND z.name = c.name;
