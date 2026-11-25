const wrapLon = (lon) => ((((lon + 180) % 360) + 360) % 360) - 180
const clampLat = (lat) => Math.max(-90, Math.min(90, lat))

/**
 * Leaflet bounds -> backend bbox [minLon, minLat, maxLon, maxLat], or null when the view
 * covers the whole world. Longitudes are wrapped into [-180, 180]; minLon > maxLon means the
 * view crosses the antimeridian (the backend handles that).
 */
export function boundsToBbox(bounds) {
  const west = bounds.getWest()
  const east = bounds.getEast()
  if (east - west >= 360) return null
  const round = (x) => Math.round(x * 1e4) / 1e4
  return [round(wrapLon(west)), round(clampLat(bounds.getSouth())), round(wrapLon(east)), round(clampLat(bounds.getNorth()))]
}
