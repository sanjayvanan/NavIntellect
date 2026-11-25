import { formatArea, formatNm } from '../../utils/geo'
import { CircleIcon, PinIcon, PolygonIcon, RectIcon } from './ui/icons'

/**
 * What kind of geometry a map object is, for display: Point (pins) or the shape a zone was drawn
 * as (Polygon, Rectangle, Circle). Adding a type = one entry here (+ its `facts`).
 *
 *   id     – 'point' | 'polygon' | 'rectangle' | 'circle'
 *   label  – shown to the user
 *   Icon   – line icon (React)
 *   facts(feature) – short figures that describe this object, e.g. ['r 3.20 nm', '32.2 nm²']
 */
const n = (v) => (v == null ? null : Number(v))
const area = (p) => (p.area_nm2 != null ? formatArea(n(p.area_nm2)) : null)

export const OBJECT_TYPES = {
  point: {
    id: 'point',
    label: 'Point',
    plural: 'Points',
    Icon: PinIcon,
    facts: (f) => {
      const [lng, lat] = f.geometry.coordinates
      return [`${Math.abs(lat).toFixed(4)}° ${lat >= 0 ? 'N' : 'S'}, ${Math.abs(lng).toFixed(4)}° ${lng >= 0 ? 'E' : 'W'}`]
    },
  },
  polygon: {
    id: 'polygon',
    label: 'Polygon',
    plural: 'Polygons',
    Icon: PolygonIcon,
    facts: (f) => {
      const c = f.properties.shape_meta?.corners
      return [c ? `${c} corners` : null, area(f.properties)].filter(Boolean)
    },
  },
  rectangle: {
    id: 'rectangle',
    label: 'Rectangle',
    plural: 'Rectangles',
    Icon: RectIcon,
    facts: (f) => {
      const m = f.properties.shape_meta || {}
      return [m.width_nm && m.height_nm ? `${formatNm(n(m.width_nm))} × ${formatNm(n(m.height_nm))}` : null, area(f.properties)].filter(Boolean)
    },
  },
  circle: {
    id: 'circle',
    label: 'Circle',
    plural: 'Circles',
    Icon: CircleIcon,
    facts: (f) => {
      const r = f.properties.shape_meta?.radius_nm
      return [r ? `r ${formatNm(n(r))}` : null, area(f.properties)].filter(Boolean)
    },
  },
}

// Same drawings as ui/icons.jsx, as SVG markup for Leaflet labels (outside React).
const GLYPH_PATHS = {
  point: '<path d="M12 21s-6-5.6-6-11a6 6 0 1 1 12 0c0 5.4-6 11-6 11z"/><circle cx="12" cy="10" r="2.2"/>',
  polygon: '<path d="M5 8 12 3l7 5-2.5 9h-9z"/>',
  rectangle: '<rect x="4" y="6" width="16" height="12" rx="1"/>',
  circle: '<circle cx="12" cy="12" r="8"/><path d="M12 12h8"/>',
}

/** Inline SVG of a type's icon in `color` (static markup; `color` must be a #rrggbb value). */
export function typeGlyphSvg(typeId, color, size = 12) {
  const safe = /^#[0-9a-fA-F]{6}$/.test(color) ? color : 'currentColor'
  return `<svg class="type-glyph" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="${safe}" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${GLYPH_PATHS[typeId] ?? GLYPH_PATHS.polygon}</svg>`
}

/** Type of a map object: pins are points; zones are the shape they were drawn as (default polygon). */
export function objectTypeOf(feature) {
  if (feature.geometry?.type === 'Point') return OBJECT_TYPES.point
  return OBJECT_TYPES[feature.properties?.shape] ?? OBJECT_TYPES.polygon
}

/** { type, facts } for a feature: the type and its describing figures. */
export function describeObject(feature) {
  const type = objectTypeOf(feature)
  return { type, facts: type.facts(feature) }
}

// Figures are shown to 2 decimals; never round a real (tiny) size down to 0, which the API rejects.
const round2 = (v) => Math.max(0.01, Math.round(v * 100) / 100)
const round6 = (v) => Math.round(v * 1e6) / 1e6
const wrapLng = (lng) => ((((lng + 180) % 360) + 360) % 360) - 180

/**
 * `shape` + `shape_meta` to save with a zone, from a finished drawing.
 * points: the vertices the user placed (for a circle: the generated ring); origin: first click.
 */
export function shapeFromDrawing(mode, points, readout, origin) {
  if (mode === 'circle') {
    return {
      shape: 'circle',
      shape_meta: { radius_nm: round2(readout.radiusNm), ...(origin ? { center: [round6(wrapLng(origin.lng)), round6(origin.lat)] } : {}) },
    }
  }
  if (mode === 'rectangle') return { shape: 'rectangle', shape_meta: { width_nm: round2(readout.widthNm), height_nm: round2(readout.heightNm) } }
  return { shape: 'polygon', shape_meta: { corners: points.length } }
}
