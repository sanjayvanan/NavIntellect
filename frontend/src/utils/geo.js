// Nautical geometry on a sphere (WGS84 mean radius). Points are Leaflet-style { lat, lng }.

export const EARTH_RADIUS_NM = 3440.065
const rad = (d) => (d * Math.PI) / 180
const deg = (r) => (r * 180) / Math.PI

/** Great-circle distance in nautical miles (haversine). */
export function distanceNm(a, b) {
  const dLat = rad(b.lat - a.lat)
  const dLng = rad(b.lng - a.lng)
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2
  return 2 * EARTH_RADIUS_NM * Math.asin(Math.min(1, Math.sqrt(h)))
}

/** Initial true bearing from a to b, 0–360°. */
export function bearingDeg(a, b) {
  const φ1 = rad(a.lat)
  const φ2 = rad(b.lat)
  const Δλ = rad(b.lng - a.lng)
  const y = Math.sin(Δλ) * Math.cos(φ2)
  const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ)
  return (deg(Math.atan2(y, x)) + 360) % 360
}

/** Point reached from p after `distNm` on initial bearing `brg`. */
export function destination(p, brg, distNm) {
  const δ = distNm / EARTH_RADIUS_NM
  const θ = rad(brg)
  const φ1 = rad(p.lat)
  const λ1 = rad(p.lng)
  const φ2 = Math.asin(Math.sin(φ1) * Math.cos(δ) + Math.cos(φ1) * Math.sin(δ) * Math.cos(θ))
  const λ2 = λ1 + Math.atan2(Math.sin(θ) * Math.sin(δ) * Math.cos(φ1), Math.cos(δ) - Math.sin(φ1) * Math.sin(φ2))
  return { lat: deg(φ2), lng: p.lng + (deg(λ2) - deg(λ1)) }
}

/** Sum of leg lengths; `closed` adds the leg from the last point back to the first. */
export function pathLengthNm(points, closed = false) {
  let total = 0
  for (let i = 1; i < points.length; i++) total += distanceNm(points[i - 1], points[i])
  if (closed && points.length > 2) total += distanceNm(points[points.length - 1], points[0])
  return total
}

/** Area of a polygon on the sphere in nm² (same formula as Leaflet.draw's geodesicArea). */
export function polygonAreaNm2(points) {
  if (points.length < 3) return 0
  let sum = 0
  for (let i = 0; i < points.length; i++) {
    const p1 = points[i]
    const p2 = points[(i + 1) % points.length]
    sum += rad(p2.lng - p1.lng) * (2 + Math.sin(rad(p1.lat)) + Math.sin(rad(p2.lat)))
  }
  return Math.abs((sum * EARTH_RADIUS_NM * EARTH_RADIUS_NM) / 2)
}

/** Polygon approximating a circle of `radiusNm` around `center` (geodesic, so it stays round at any latitude). */
export function circlePolygon(center, radiusNm, steps = 72) {
  return Array.from({ length: steps }, (_, i) => destination(center, (360 * i) / steps, radiusNm))
}

// Web Mercator y for a latitude.
const mercY = (lat) => Math.log(Math.tan(Math.PI / 4 + rad(lat) / 2))

/**
 * Length of the rhumb line (constant bearing: the straight line on a Mercator map) from a to b.
 * Always ≥ the great-circle distance.
 */
export function rhumbDistanceNm(a, b) {
  const dPhi = rad(b.lat - a.lat)
  const dPsi = mercY(b.lat) - mercY(a.lat)
  // East–west lines: dPsi → 0, use the parallel's scale instead.
  const q = Math.abs(dPsi) > 1e-12 ? dPhi / dPsi : Math.cos(rad(a.lat))
  const dLambda = rad(b.lng - a.lng)
  return Math.sqrt(dPhi * dPhi + q * q * dLambda * dLambda) * EARTH_RADIUS_NM
}

/** Point at fraction f along the rhumb line from a to b (equal steps in distance). */
function rhumbIntermediate(a, b, f) {
  const lat = a.lat + (b.lat - a.lat) * f
  const dPsi = mercY(b.lat) - mercY(a.lat)
  // Longitude is linear in Mercator y along a rhumb line (linear in f for east–west lines).
  const t = Math.abs(dPsi) > 1e-12 ? (mercY(lat) - mercY(a.lat)) / dPsi : f
  return { lat, lng: a.lng + (b.lng - a.lng) * t }
}

/**
 * Adds points so no edge is longer than `maxNm`, along the straight line the user sees on the
 * (Mercator) map, i.e. the rhumb line. The server joins vertices with great circles; on long edges
 * those bow away from the drawn line, so densifying keeps the stored zone where it was drawn.
 */
export function densify(points, closed, maxNm = 25) {
  const out = []
  const n = points.length
  const last = closed ? n : n - 1
  for (let i = 0; i < last; i++) {
    const a = points[i]
    const b = points[(i + 1) % n]
    out.push(a)
    const steps = Math.ceil(rhumbDistanceNm(a, b) / maxNm)
    for (let s = 1; s < steps; s++) out.push(rhumbIntermediate(a, b, s / steps))
  }
  if (!closed) out.push(points[n - 1])
  return out
}

/**
 * Leaflet points → GeoJSON Polygon. The map repeats the world (worldCopyJump), so longitudes can
 * run past ±180: shift the whole ring back by a multiple of 360 rather than wrapping each vertex.
 * Throws if the shape straddles the antimeridian (not supported by the backend).
 */
export function toGeoJsonPolygon(points) {
  const shift = 360 * Math.round(points[0].lng / 360)
  const ring = points.map((p) => [round6(p.lng - shift), round6(p.lat)])
  if (ring.some(([lng]) => lng < -180 || lng > 180)) {
    throw new Error('Shapes that cross the 180° meridian are not supported yet. Draw it as two shapes.')
  }
  ring.push([...ring[0]])
  return { type: 'Polygon', coordinates: [ring] }
}
const round6 = (n) => Math.round(n * 1e6) / 1e6

/** GeoJSON (Multi)Polygon → outer rings as arrays of { lat, lng }. */
export function outerRings(geometry) {
  const polys = geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates
  return polys.map((poly) => poly[0].slice(0, -1).map(([lng, lat]) => ({ lat, lng })))
}

/** Ray-casting point-in-polygon on lat/lng (fine for hit-testing clicks). */
export function pointInRing(p, ring) {
  let inside = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i]
    const b = ring[j]
    if (a.lat > p.lat !== b.lat > p.lat && p.lng < ((b.lng - a.lng) * (p.lat - a.lat)) / (b.lat - a.lat) + a.lng) inside = !inside
  }
  return inside
}

const nf = (digits) => new Intl.NumberFormat('en', { maximumFractionDigits: digits, minimumFractionDigits: digits })

/** 0.42 nm → "778 m"; 3.456 → "3.46 nm"; 42.1 → "42.1 nm"; 1234 → "1,234 nm". */
export function formatNm(nm) {
  if (!Number.isFinite(nm)) return '–'
  if (nm < 0.1) return `${Math.round(nm * 1852)} m`
  return `${nf(nm < 10 ? 2 : nm < 100 ? 1 : 0).format(nm)} nm`
}

export function formatArea(nm2) {
  if (!Number.isFinite(nm2)) return '–'
  return `${nf(nm2 < 10 ? 2 : nm2 < 1000 ? 1 : 0).format(nm2)} nm²`
}

export const formatBearing = (b) => `${String(Math.round(b) % 360).padStart(3, '0')}°T`
