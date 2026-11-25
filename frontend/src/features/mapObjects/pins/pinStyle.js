import L from 'leaflet'

/**
 * Pin look: colours, glyphs and the Leaflet marker icon.
 * PIN_ICONS must match backend/src/api/annotations/kinds.ts (PIN_ICONS). Adding a glyph = one
 * entry in GLYPHS + the backend enum.
 */

// Glyphs drawn inside the pin head (24×24 stroke paths).
export const GLYPHS = {
  pin: '<circle cx="12" cy="12" r="3.2" fill="currentColor" stroke="none"/>',
  anchor: '<circle cx="12" cy="5.5" r="1.8"/><path d="M12 7.3V19M8 10.5h8M5.5 13.5a6.5 6.5 0 0 0 13 0"/>',
  flag: '<path d="M7.5 20V4.5M7.5 5h9.5l-2.2 3.2L17 11.5H7.5"/>',
  warning: '<path d="M12 4.5 3.8 18.5h16.4L12 4.5zM12 10v3.8M12 16.3v.2"/>',
  camera: '<path d="M4.5 8.5h3l1.7-2h5.6l1.7 2h3v9.5h-15z"/><circle cx="12" cy="13" r="2.8"/>',
  star: '<path d="m12 4.5 2.3 4.8 5.2.7-3.8 3.6.9 5.2L12 16.3l-4.6 2.5.9-5.2-3.8-3.6 5.2-.7z"/>',
}
export const PIN_ICONS = Object.keys(GLYPHS)
export const PIN_ICON_LABELS = { pin: 'Pin', anchor: 'Anchor', flag: 'Flag', warning: 'Warning', camera: 'Camera', star: 'Star' }
export const PIN_COLORS = ['#16c5d8', '#1e88e5', '#3949ab', '#8e24aa', '#e53935', '#fb8c00', '#fdd835', '#43a047']
export const DEFAULT_PIN_STYLE = { color: PIN_COLORS[0], icon: 'pin' }

const SAFE_COLOR = /^#[0-9a-fA-F]{6}$/
const safeStyle = (style = {}) => ({
  color: SAFE_COLOR.test(style.color) ? style.color : DEFAULT_PIN_STYLE.color,
  icon: GLYPHS[style.icon] ? style.icon : DEFAULT_PIN_STYLE.icon,
})

/** SVG markup of a pin (teardrop + glyph), 32×42 with the tip at the bottom centre. */
export function pinSvg(style, { selected = false } = {}) {
  const { color, icon } = safeStyle(style)
  return `<svg class="pin-svg" width="32" height="42" viewBox="0 0 32 42" aria-hidden="true">
    <path d="M16 40.5S4 28.6 4 17.6a12 12 0 1 1 24 0c0 11-12 22.9-12 22.9z" fill="${color}" stroke="${selected ? '#071b35' : '#fff'}" stroke-width="${selected ? 3 : 2}"/>
    <g transform="translate(8 9.6) scale(0.667)" fill="none" stroke="#fff" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" color="#fff">${GLYPHS[icon]}</g>
  </svg>`
}

/** Leaflet icon for a pin; the anchor is the tip, so the pin points exactly at its position. */
export function pinMarkerIcon(style, { selected = false, ghost = false } = {}) {
  return L.divIcon({
    className: `map-pin ${selected ? 'selected' : ''} ${ghost ? 'ghost' : ''}`,
    html: pinSvg(style, { selected }),
    iconSize: [32, 42],
    iconAnchor: [16, 41],
    tooltipAnchor: [0, -36],
  })
}

/** Leaflet [lat, lng] of a pin feature. */
export const pinLatLng = (feature) => {
  const [lng, lat] = feature.geometry.coordinates
  return { lat, lng }
}
