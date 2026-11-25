-- Preset outlines have long edges (the Gulf of Aden corridor spans 8° of longitude). The map draws
-- straight lines between vertices while geography edges follow great circles, which bow several nm
-- away over that distance. Adding a vertex every 0.1° keeps the stored zone where it is drawn.
UPDATE zones
SET geom = ST_Multi(ST_Segmentize(geom::geometry, 0.1))::geography,
    updated_at = now()
WHERE preset;
