import { useEffect, useRef } from 'react'
import L from 'leaflet'

/**
 * For UI rendered inside the Leaflet map container (search box, zoom buttons, bars, panels):
 * stops clicks, double-clicks, drags and wheel events from reaching the map, so e.g. clicking a
 * button never also "clicks" the ship drawn underneath it. Returns a ref for the element.
 */
export function useIsolateFromMap() {
  const ref = useRef(null)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    L.DomEvent.disableClickPropagation(el)
    L.DomEvent.disableScrollPropagation(el)
  }, [])
  return ref
}
