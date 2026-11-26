import { apiFetch } from './api'

/** Periods offered for a ship's track. The server keeps about 3 days of positions. */
export const TRACK_PERIODS = [
  { hours: 6, label: '6h' },
  { hours: 24, label: '24h' },
  { hours: 72, label: '3d' },
]
export const DEFAULT_TRACK_HOURS = 24

const MAX_POINTS = 5000

/** GET /api/vessels/:mmsi/track for the last `hours`: a GeoJSON Feature with properties.times. */
export function fetchTrack(mmsi, hours) {
  const to = new Date()
  const from = new Date(to.getTime() - hours * 3600_000)
  const q = new URLSearchParams({ from: from.toISOString(), to: to.toISOString() })
  return apiFetch(`/api/vessels/${mmsi}/track?${q}`)
}

/**
 * Track Feature -> Leaflet data.
 * Returns { segments: [[lat, lng][]], points: { lat, lng, time }[] }, where `points` is thinned
 * to at most MAX_POINTS and `segments` is the line, split where it crosses the antimeridian
 * (a jump of more than 180° in longitude) so it is not drawn right across the map.
 */
export function trackToLatLngs(feature) {
  const g = feature?.geometry
  const coords = !g ? [] : g.type === 'Point' ? [g.coordinates] : g.type === 'LineString' ? g.coordinates : []
  const times = feature?.properties?.times
  let points = coords.map(([lng, lat], i) => ({ lat, lng, time: times?.[i] ?? null }))

  if (points.length > MAX_POINTS) {
    const step = (points.length - 1) / (MAX_POINTS - 1)
    points = Array.from({ length: MAX_POINTS }, (_, i) => points[Math.round(i * step)])
  }

  const segments = []
  let current = []
  for (const p of points) {
    const prev = current[current.length - 1]
    if (prev && Math.abs(p.lng - prev[1]) > 180) {
      segments.push(current)
      current = []
    }
    current.push([p.lat, p.lng])
  }
  if (current.length) segments.push(current)
  return { segments, points }
}
