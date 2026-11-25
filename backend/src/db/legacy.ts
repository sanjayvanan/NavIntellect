/**
 * SQL select list producing the legacy ship shape expected by the frontend
 * (src/components/ShipLayer.jsx). Every numeric field is cast to float8/int4 so node-pg
 * returns JS numbers (not strings): the UI calls latitude.toFixed() and would crash otherwise.
 * Expects aliases: l = vessel_latest, v = vessels.
 */
export const LEGACY_SHIP_COLUMNS = `
  v.uuid::text                                            AS uuid,
  v.mmsi::int4                                            AS mmsi,
  COALESCE(v.name, 'MMSI ' || v.mmsi)                     AS track_name,
  COALESCE(v.ship_type_label, 'Vessel')                   AS type,
  l.lat::float8                                           AS latitude,
  l.lon::float8                                           AS longitude,
  round(COALESCE(l.sog, 0)::numeric, 1)::float8          AS speed_over_ground,
  round(COALESCE(l.cog, 0)::numeric, 1)::float8          AS course_over_ground,
  COALESCE(l.heading, round(l.cog), 0)::float8            AS true_heading,
  (extract(epoch FROM l.ts) * 1000)::float8               AS sensor_timestamp,
  l.msg_type::int4                                        AS message_type__id`;
