import { useEffect, useRef } from 'react'
import { useDispatch, useSelector } from 'react-redux'
import { useMap } from 'react-leaflet'
import L from 'leaflet'
import { canEdit } from '../scope'
import { isSelected, selectObject } from '../uiSlice'
import { fetchPins, movePin } from './pinsSlice'
import { pinLatLng, pinMarkerIcon } from './pinStyle'

const escapeHtml = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c])

/**
 * Draws the visible pins as Leaflet markers and keeps them in sync with the store: markers are
 * updated in place (not recreated), so an ongoing drag is never interrupted. Pins the user can
 * edit are draggable; a drop saves the new position (optimistically, see movePin).
 */
function PinsLayer() {
  const map = useMap()
  const dispatch = useDispatch()
  const pins = useSelector((s) => s.pins.items)
  const hidden = useSelector((s) => s.theme.hidden.pin)
  const selection = useSelector((s) => s.mapObjectsUi.selection)
  const user = useSelector((s) => s.auth.user)
  const markers = useRef(new Map()) // id -> { marker, key }

  useEffect(() => {
    dispatch(fetchPins())
  }, [dispatch])

  useEffect(() => {
    const hiddenSet = new Set(hidden)
    const seen = new Set()
    for (const pin of pins) {
      if (hiddenSet.has(pin.id)) continue
      seen.add(pin.id)
      const p = pin.properties
      const selected = isSelected(selection, 'pin', pin.id)
      const editable = canEdit(pin, user)
      const latlng = pinLatLng(pin)
      // Re-style only when something visible changed.
      const key = `${p.style?.color}|${p.style?.icon}|${selected}|${p.name}`
      let entry = markers.current.get(pin.id)
      if (!entry) {
        const marker = L.marker(latlng, {
          icon: pinMarkerIcon(p.style, { selected }),
          draggable: editable,
          riseOnHover: true,
          keyboard: true,
        })
        marker.on('click', () => {
          if (!map._drawingActive) dispatch(selectObject({ type: 'pin', id: pin.id }))
        })
        marker.on('dragstart', () => marker.closeTooltip())
        marker.on('dragend', () => {
          const current = markers.current.get(pin.id)
          const next = map.wrapLatLng(marker.getLatLng())
          dispatch(movePin({ id: pin.id, latlng: { lat: next.lat, lng: next.lng }, previous: current.coords }))
        })
        marker.bindTooltip(escapeHtml(p.name), { direction: 'top', className: 'pin-tooltip' })
        marker.addTo(map)
        // Accessible name (divIcons ignore `alt`; no `title`, the Leaflet tooltip is the hover label).
        marker.getElement()?.setAttribute('aria-label', `Pin: ${p.name}`)
        entry = { marker, key }
        markers.current.set(pin.id, entry)
      } else if (entry.key !== key) {
        entry.marker.setIcon(pinMarkerIcon(p.style, { selected }))
        entry.marker.setTooltipContent(escapeHtml(p.name))
        entry.marker.getElement()?.setAttribute('aria-label', `Pin: ${p.name}`)
        entry.key = key
      }
      entry.coords = pin.geometry.coordinates
      const m = entry.marker
      const at = m.getLatLng()
      if (at.lat !== latlng.lat || at.lng !== latlng.lng) m.setLatLng(latlng)
      if (m.dragging) editable ? m.dragging.enable() : m.dragging.disable()
      m.setZIndexOffset(selected ? 1000 : 0)
    }
    // Remove markers of deleted / hidden pins.
    for (const [id, entry] of markers.current) {
      if (!seen.has(id)) {
        entry.marker.remove()
        markers.current.delete(id)
      }
    }
  }, [map, dispatch, pins, hidden, selection, user])

  // Unmount (sign-out): remove every marker.
  useEffect(() => {
    const all = markers.current
    return () => {
      for (const { marker } of all.values()) marker.remove()
      all.clear()
    }
  }, [])

  return null
}

export default PinsLayer
