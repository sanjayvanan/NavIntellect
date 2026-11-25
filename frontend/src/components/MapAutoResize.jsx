import { useEffect } from 'react'
import { useMap } from 'react-leaflet'

/** Keeps Leaflet's size in sync when its container changes (sidebar collapse, fullscreen, window resize). */
function MapAutoResize() {
  const map = useMap()
  useEffect(() => {
    const el = map.getContainer()
    let raf = null
    const observer = new ResizeObserver(() => {
      cancelAnimationFrame(raf)
      raf = requestAnimationFrame(() => map.invalidateSize({ pan: false }))
    })
    observer.observe(el)
    return () => {
      cancelAnimationFrame(raf)
      observer.disconnect()
    }
  }, [map])
  return null
}

export default MapAutoResize
