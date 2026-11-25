// Zone kinds, colours and their labels (kinds mirror the backend's zone_kind enum).

export const ZONE_KINDS = [
  { value: 'monitoring', label: 'Monitoring' },
  { value: 'restricted', label: 'Restricted' },
  { value: 'port', label: 'Port' },
  { value: 'anchorage', label: 'Anchorage' },
]
export const KIND_LABEL = Object.fromEntries(ZONE_KINDS.map((k) => [k.value, k.label]))
export const KIND_COLORS = { restricted: '#e53935', monitoring: '#1e88e5', port: '#43a047', anchorage: '#fb8c00' }
export const ZONE_COLORS = ['#16c5d8', '#1e88e5', '#3949ab', '#8e24aa', '#e53935', '#fb8c00', '#fdd835', '#43a047']

/** Display colour: the zone's own colour, else its kind's. */
export const zoneColor = (zone) => zone.properties.color || KIND_COLORS[zone.properties.kind] || '#1e88e5'

/** Leaflet path style for a zone. Restricted zones are dashed; zones without alerts are dotted. */
export function zonePathStyle(zone, selected) {
  const color = zoneColor(zone)
  const p = zone.properties
  return {
    color,
    weight: selected ? 3.5 : 2,
    opacity: selected ? 1 : 0.85,
    fillColor: color,
    fillOpacity: selected ? 0.22 : 0.08,
    dashArray: p.kind === 'restricted' ? '8 5' : p.active ? null : '2 5',
  }
}
