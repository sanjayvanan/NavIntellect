import { apiFetch } from './api'

/** Periods offered for a ship's track. The server keeps about 3 days of positions. */
export const TRACK_PERIODS = [
  { hours: 6, label: '6h' },
  { hours: 24, label: '24h' },
  { hours: 72, label: '3d' },
]
export const DEFAULT_TRACK_HOURS = 24
// Douglas–Peucker tolerance asked of the server, in degrees (0.0004 ≈ 44 m): points closer than
// this to the line through their neighbours are dropped, so long tracks load and draw faster.
export const TRACK_TOLERANCE_DEG = 0.0004

const MAX_POINTS = 5000
// Two positions further apart than this in time are a gap in reception (positions are stored
// every 2 minutes and on turns): the straight line between them is a guess, drawn dashed.
export const GAP_MINUTES = 10
const GAP_MIN_NM = 0.3 // a ship that sat still during the gap needs no dashed line

/** Rough distance in nautical miles (fine for deciding whether a gap is worth marking). */
const roughNm = (a, b) => {
  const dLat = b.lat - a.lat
  const dLng = (b.lng - a.lng) * Math.cos(((a.lat + b.lat) / 2) * (Math.PI / 180))
  return Math.hypot(dLat, dLng) * 60
}

/** GET /api/vessels/:mmsi/track for the last `hours`: a GeoJSON Feature with properties.times. */
export function fetchTrack(mmsi, hours) {
  const to = new Date()
  const from = new Date(to.getTime() - hours * 3600_000)
  const q = new URLSearchParams({ from: from.toISOString(), to: to.toISOString(), tolerance: String(TRACK_TOLERANCE_DEG) })
  return apiFetch(`/api/vessels/${mmsi}/track?${q}`)
}

/**
 * Track Feature -> Leaflet data.
 * Returns { segments: [[lat, lng][]], gaps: { from, to, minutes }[], points: { lat, lng, time }[] }:
 * - `points` is thinned to at most MAX_POINTS.
 * - `segments` is the solid line: split where it crosses the antimeridian (a jump of more than
 *   180° in longitude, so it is not drawn right across the map) and at gaps.
 * - `gaps` are stretches with no reports for over GAP_MINUTES: the ship's real route there is
 *   unknown (it may follow a river bend), so they are drawn as a dashed straight line. A simplified
 *   track says where they are (properties.breaks): after simplifying, a straight stretch with its
 *   middle points dropped also has long time steps, which are not gaps.
 */
export function trackToLatLngs(feature) {
  const g = feature?.geometry
  const coords = !g ? [] : g.type === 'Point' ? [g.coordinates] : g.type === 'LineString' ? g.coordinates : []
  const times = feature?.properties?.times
  let points = coords.map(([lng, lat], i) => ({ lat, lng, time: times?.[i] ?? null }))

  const breaks = Array.isArray(feature?.properties?.breaks) ? new Set(feature.properties.breaks) : null
  if (!breaks && points.length > MAX_POINTS) {
    const step = (points.length - 1) / (MAX_POINTS - 1)
    points = Array.from({ length: MAX_POINTS }, (_, i) => points[Math.round(i * step)])
  }

  const segments = []
  const gaps = []
  let current = []
  for (let i = 0; i < points.length; i++) {
    const p = points[i]
    const prev = points[i - 1]
    if (prev && Math.abs(p.lng - prev.lng) > 180) {
      segments.push(current)
      current = []
    } else if (prev && p.time != null && prev.time != null) {
      const minutes = (p.time - prev.time) / 60_000
      if (breaks ? breaks.has(i) : minutes > GAP_MINUTES && roughNm(prev, p) > GAP_MIN_NM) {
        gaps.push({ from: [prev.lat, prev.lng], to: [p.lat, p.lng], minutes: Math.round(minutes) })
        segments.push(current)
        current = []
      }
    }
    current.push([p.lat, p.lng])
  }
  if (current.length) segments.push(current)
  return { segments: segments.filter((seg) => seg.length > 0), gaps, points }
}
