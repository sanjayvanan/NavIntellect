import L from 'leaflet'

/**
 * Smooth camera moves for the map.
 *
 * Leaflet has two animations:
 *  - the CSS zoom animation (setView/fitBounds with animate): one GPU transform of tiles and
 *    layers, then a single redraw at `zoomend`. Smooth and cheap, but only for zoom changes of
 *    up to `zoomAnimationThreshold` (4) levels;
 *  - flyTo: a JavaScript animation that moves through every intermediate (fractional) zoom,
 *    loading tiles at each level and redrawing every layer on every frame. Expensive.
 * These helpers use the CSS animation whenever possible (stepping in hops of ≤ 4 levels for big
 * zoom changes) and keep flyTo for long-distance jumps only.
 */

const prefersReducedMotion = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false

/** Leaflet only CSS-animates zoom changes up to this many levels. */
const animatedZoomLimit = (map) => map.options.zoomAnimationThreshold ?? 4

const clampZoom = (map, zoom) => Math.max(map.getMinZoom(), Math.min(map.getMaxZoom(), zoom))

/**
 * Centres the map on `latlng` at `zoom`, animating smoothly.
 * Far targets (more than ~2 screens away) still use flyTo, which gives context for the jump.
 */
export function zoomToPoint(map, latlng, zoom = map.getZoom()) {
  const target = L.latLng(latlng)
  const z = clampZoom(map, zoom)
  if (prefersReducedMotion()) {
    map.setView(target, z, { animate: false })
    return
  }
  const near = map.getBounds().pad(1).contains(target)
  if (!near) {
    map.flyTo(target, z, { duration: 0.9 })
    return
  }
  stepZoom(map, target, z)
}

/** Chains CSS-animated hops of at most `animatedZoomLimit` levels until `z` is reached. */
function stepZoom(map, target, z) {
  const limit = animatedZoomLimit(map)
  const current = map.getZoom()
  const delta = z - current
  const next = Math.abs(delta) <= limit ? z : current + Math.sign(delta) * limit
  if (next !== z) map.once('zoomend', () => stepZoom(map, target, z))
  // animate: true also animates when the new centre is off screen.
  map.setView(target, next, { animate: true })
}

/** Fits `bounds` in view (minus `padding` px on each side, zoom kept within [minZoom, maxZoom]), smoothly. */
export function zoomToBounds(map, bounds, { padding = [40, 40], maxZoom = map.getMaxZoom(), minZoom = map.getMinZoom() } = {}) {
  const b = L.latLngBounds(bounds)
  if (!b.isValid()) return
  const pad = L.point(padding)
  const zoom = Math.max(minZoom, Math.min(maxZoom, map.getBoundsZoom(b, false, pad.multiplyBy(2))))
  zoomToPoint(map, b.getCenter(), zoom)
}
