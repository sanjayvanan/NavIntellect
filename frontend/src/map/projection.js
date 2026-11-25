// Web Mercator (EPSG:3857) helpers that avoid Leaflet's per-call allocations.
//
// A point's *normalised* position is its world-pixel position at zoom 0 divided by the tile
// size: both coordinates are in [0, 1]. Multiply by `worldSize(zoom)` (= 256 · 2^zoom) to get
// the same world pixels `map.project(latlng, zoom)` returns. Computing the normalised value once
// per data update turns per-frame projection into one multiply-add per ship.

const MAX_LATITUDE = 85.0511287798 // Leaflet's L.Projection.SphericalMercator.MAX_LATITUDE
const D2R = Math.PI / 180
export const TILE_SIZE = 256

/** World size in pixels at a (possibly fractional) zoom, as L.CRS.EPSG3857.scale(zoom). */
export const worldSize = (zoom) => TILE_SIZE * 2 ** zoom

/** Normalised x in [0, 1] for a longitude (not wrapped: 190° gives 1.027…, like Leaflet). */
export const normX = (lng) => 0.5 + lng / 360

/** Normalised y in [0, 1] for a latitude (clamped to the Mercator limit, like Leaflet). */
export function normY(lat) {
  const s = Math.sin(Math.max(Math.min(MAX_LATITUDE, lat), -MAX_LATITUDE) * D2R)
  return 0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)
}

/**
 * Normalised positions for many points at once, in typed arrays (index-aligned with `items`).
 * Items without coordinates get NaN, which callers skip.
 */
export function normalisePositions(items, latOf, lngOf) {
  const n = items.length
  const xs = new Float64Array(n)
  const ys = new Float64Array(n)
  for (let i = 0; i < n; i++) {
    const lat = latOf(items[i])
    const lng = lngOf(items[i])
    if (lat == null || lng == null) {
      xs[i] = NaN
      ys[i] = NaN
    } else {
      xs[i] = normX(lng)
      ys[i] = normY(lat)
    }
  }
  return { xs, ys }
}
