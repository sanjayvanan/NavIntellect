import { useEffect, useRef } from 'react'
import L from 'leaflet'
import { DEFAULT_PIN_STYLE, pinMarkerIcon } from './pinStyle'

/**
 * Shows the not-yet-saved pin at `latlng` (null = none). It can be dragged to fine-tune the
 * position before saving; `onMove(latlng)` reports the new spot.
 */
export function useDraftPinMarker(map, latlng, onMove) {
  const onMoveRef = useRef(onMove)
  onMoveRef.current = onMove
  const markerRef = useRef(null)
  const active = latlng != null

  useEffect(() => {
    if (!active) return
    const marker = L.marker([0, 0], { icon: pinMarkerIcon(DEFAULT_PIN_STYLE, { selected: true }), draggable: true, zIndexOffset: 2000 })
    marker.on('dragend', () => {
      const p = map.wrapLatLng(marker.getLatLng())
      onMoveRef.current?.({ lat: p.lat, lng: p.lng })
    })
    markerRef.current = marker
    return () => {
      marker.remove()
      markerRef.current = null
    }
  }, [map, active])

  useEffect(() => {
    const marker = markerRef.current
    if (!marker || !latlng) return
    marker.setLatLng(latlng)
    if (!map.hasLayer(marker)) marker.addTo(map)
  }, [map, latlng])
}
