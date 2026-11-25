import { useEffect, useRef } from 'react'
import { useDispatch, useSelector } from 'react-redux'
import { useMap } from 'react-leaflet'
import L from 'leaflet'
import { outerRings, pointInRing } from '../../../utils/geo'
import { isSelected, selectObject } from '../uiSlice'
import { fetchZones } from './zonesSlice'
import { zoneColor, zonePathStyle } from './zoneStyle'

const LABEL_MIN_ZOOM = 4

/**
 * Draws the visible geofences. Paths are not interactive (ships drawn on the canvas above must
 * stay clickable); a map click that hit no ship selects the smallest zone under the pointer.
 */
function ZonesLayer() {
  const map = useMap()
  const dispatch = useDispatch()
  const zones = useSelector((s) => s.zones.items)
  const selection = useSelector((s) => s.mapObjectsUi.selection)
  const hidden = useSelector((s) => s.theme.hidden.zone)
  const visibleRef = useRef([])

  useEffect(() => {
    dispatch(fetchZones())
  }, [dispatch])

  // Shapes + labels
  useEffect(() => {
    const hiddenSet = new Set(hidden)
    const visible = zones.filter((z) => !hiddenSet.has(z.id))
    visibleRef.current = visible.map((z) => ({ id: z.id, area: Number(z.properties.area_nm2) || 0, rings: outerRings(z.geometry) }))
    const group = L.featureGroup()
    for (const z of visible) {
      const color = zoneColor(z)
      const selected = isSelected(selection, 'zone', z.id)
      const p = z.properties
      const layer = L.geoJSON(z.geometry, { interactive: false, style: zonePathStyle(z, selected) })
      layer.bindTooltip(
        `<span data-zone-id="${z.id}"><span class="zone-label-dot" style="background:${color}"></span>${escapeHtml(p.name)}${p.active ? ' <b class="zone-label-live">●</b>' : ''}</span>`,
        { permanent: true, direction: 'center', className: `zone-label ${selected ? 'selected' : ''}`, interactive: false },
      )
      group.addLayer(layer)
    }
    const showLabels = () => {
      const on = map.getZoom() >= LABEL_MIN_ZOOM || group.getLayers().length <= 3
      group.eachLayer((l) => (on ? l.openTooltip() : l.closeTooltip()))
    }
    group.addTo(map)
    showLabels()
    map.on('zoomend', showLabels)
    return () => {
      map.off('zoomend', showLabels)
      group.remove()
    }
  }, [map, zones, hidden, selection])

  // Click selection
  useEffect(() => {
    const onClick = (e) => {
      if (map._drawingActive) return
      // ShipCanvasLayer marks the event when the click landed on a ship; it may run after us.
      setTimeout(() => {
        if (e.shipHit) return
        const p = e.latlng
        const wrapped = map.wrapLatLng(p)
        const hits = visibleRef.current.filter((z) =>
          z.rings.some((ring) => pointInRing(p, ring) || pointInRing(wrapped, ring)),
        )
        hits.sort((a, b) => a.area - b.area)
        if (hits[0]) dispatch(selectObject({ type: 'zone', id: hits[0].id }))
      }, 0)
    }
    map.on('click', onClick)

    // Labels are clickable too (small zones are only a few pixels wide when zoomed out). Capture
    // phase on the container, so Leaflet never sees the click (no ship/cluster under the label reacts).
    const container = map.getContainer()
    const onLabel = (e) => {
      const el = e.target.closest?.('.zone-label [data-zone-id]') || e.target.querySelector?.('[data-zone-id]')
      if (!el || !e.target.closest('.zone-label') || map._drawingActive) return
      e.stopPropagation()
      dispatch(selectObject({ type: 'zone', id: el.dataset.zoneId }))
    }
    container.addEventListener('click', onLabel, true)
    return () => {
      map.off('click', onClick)
      container.removeEventListener('click', onLabel, true)
    }
  }, [map, dispatch])

  return null
}

const escapeHtml = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c])

export default ZonesLayer
