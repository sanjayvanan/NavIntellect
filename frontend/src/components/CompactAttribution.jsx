import { useEffect } from 'react'
import { useMap } from 'react-leaflet'
import L from 'leaflet'

/**
 * Map data credits as a small ⓘ button that expands on hover/focus (tap on touch screens).
 * The OpenStreetMap tile policy and Esri's terms require the credits to stay reachable on the
 * map, so they are collapsed, not removed. The "Leaflet" prefix is optional and dropped.
 */
function CompactAttribution() {
  const map = useMap()
  useEffect(() => {
    const ctl = map.attributionControl
    if (!ctl) return
    ctl.setPrefix(false)
    const el = ctl.getContainer()
    el.classList.add('attribution-compact')
    el.tabIndex = 0
    el.setAttribute('aria-label', 'Map data credits')
    const toggle = (e) => {
      if (e.target.closest('a')) return // let credit links work
      el.classList.toggle('open')
    }
    L.DomEvent.disableClickPropagation(el)
    el.addEventListener('click', toggle)
    return () => el.removeEventListener('click', toggle)
  }, [map])
  return null
}

export default CompactAttribution
