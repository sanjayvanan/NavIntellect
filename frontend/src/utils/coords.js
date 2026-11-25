// Coordinate formatting shared by ship popups, pins and drawing tools.

/**
 * One coordinate as degrees/minutes/seconds, e.g. 18.9 (lat) -> `18° 54' 0.00" N`.
 * Rounding carries over (59.999" becomes the next minute, never 60.00").
 */
export function toDMS(decimal, isLatitude, secondsDigits = 2) {
  const direction = isLatitude ? (decimal >= 0 ? 'N' : 'S') : decimal >= 0 ? 'E' : 'W'
  const factor = 10 ** secondsDigits
  // Work in whole units of the last shown digit so rounding can't produce 60 seconds.
  let units = Math.round(Math.abs(decimal) * 3600 * factor)
  const degrees = Math.floor(units / (3600 * factor))
  units -= degrees * 3600 * factor
  const minutes = Math.floor(units / (60 * factor))
  const seconds = (units - minutes * 60 * factor) / factor
  return `${degrees}° ${minutes}' ${seconds.toFixed(secondsDigits)}" ${direction}`
}

/** Decimal degrees with fixed precision, e.g. "18.90000, 72.80000". */
export const formatDecimal = ({ lat, lng }, digits = 5) => `${lat.toFixed(digits)}, ${lng.toFixed(digits)}`

/** Compact human form for tooltips: `18° 54' 0.0" N  72° 48' 0.0" E`. */
export const formatLatLng = ({ lat, lng }) => `${toDMS(lat, true, 1)}&nbsp;&nbsp;${toDMS(lng, false, 1)}`

/** Plain-text form for the clipboard: both DMS and decimal. */
export const coordsForClipboard = (p) => `${toDMS(p.lat, true)} ${toDMS(p.lng, false)} (${formatDecimal(p, 6)})`
