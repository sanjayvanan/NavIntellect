import { useEffect, useRef, useState } from 'react'
import { useMap } from 'react-leaflet'
import { useSelector } from 'react-redux'
import L from 'leaflet'
import { useIsolateFromMap } from '../hooks/useIsolateFromMap'
import { zoomToPoint } from '../map/navigation'
import { LocateIcon } from './Icons'

const MIN_ZOOM_ON_LOCATE = 13
const MESSAGE_MS = 6000

const ERROR_TEXT = {
  1: 'Location is blocked for this site. Allow it in your browser or phone settings, then try again.',
  2: 'Your location is not available right now. Check that location services are on.',
  3: 'Finding your location took too long. Try again, ideally outdoors or with Wi-Fi on.',
}

/**
 * "Show my location": a button that finds the device's position, moves the map there and keeps a
 * blue dot (with an accuracy circle) on it while it moves. Tap again to come back to it; tap when
 * already there to turn it off. Browsers only allow this on https (or localhost).
 */
function LocateControl() {
  const map = useMap()
  const theme = useSelector((state) => state.theme.mode)
  const ref = useIsolateFromMap()
  const [status, setStatus] = useState('off') // off | locating | on
  const [message, setMessage] = useState(null)
  const watchRef = useRef(null)
  const layersRef = useRef(null)
  const lastRef = useRef(null) // last known L.LatLng
  const firstFixRef = useRef(false)

  // The dot draws above the ships, never takes clicks.
  useEffect(() => {
    if (!map.getPane('locate')) map.createPane('locate').style.zIndex = 460
  }, [map])

  useEffect(() => {
    if (!message) return
    const t = setTimeout(() => setMessage(null), MESSAGE_MS)
    return () => clearTimeout(t)
  }, [message])

  const stop = () => {
    if (watchRef.current != null) navigator.geolocation.clearWatch(watchRef.current)
    watchRef.current = null
    layersRef.current?.remove()
    layersRef.current = null
    lastRef.current = null
    setStatus('off')
  }
  useEffect(() => stop, []) // turn the location off when the map goes away

  const onPosition = ({ coords }) => {
    const here = L.latLng(coords.latitude, coords.longitude)
    lastRef.current = here
    if (!layersRef.current) {
      layersRef.current = L.layerGroup([
        L.circle(here, { pane: 'locate', radius: coords.accuracy, color: '#1e88e5', weight: 1, fillColor: '#1e88e5', fillOpacity: 0.12, interactive: false }),
        L.circleMarker(here, { pane: 'locate', radius: 8, color: '#ffffff', weight: 3, fillColor: '#1e88e5', fillOpacity: 1, interactive: false, className: 'my-location-dot' }),
      ]).addTo(map)
    } else {
      const [accuracy, dot] = layersRef.current.getLayers()
      accuracy.setLatLng(here).setRadius(coords.accuracy)
      dot.setLatLng(here)
    }
    setStatus('on')
    if (!firstFixRef.current) {
      firstFixRef.current = true
      zoomToPoint(map, here, Math.max(map.getZoom(), MIN_ZOOM_ON_LOCATE))
    }
  }

  const onError = (err) => {
    stop()
    setMessage(ERROR_TEXT[err.code] ?? 'Could not find your location.')
  }

  const handleClick = () => {
    if (!('geolocation' in navigator)) {
      setMessage('This browser cannot share your location.')
      return
    }
    if (window.isSecureContext === false) {
      setMessage('Your location can only be shown on a secure (https) address, such as the hosted site.')
      return
    }
    if (status === 'on' && lastRef.current) {
      // Already there: turn it off. Otherwise: go back to it.
      const offset = map.latLngToContainerPoint(lastRef.current).distanceTo(map.getSize().divideBy(2))
      if (offset < 40) stop()
      else zoomToPoint(map, lastRef.current, Math.max(map.getZoom(), MIN_ZOOM_ON_LOCATE))
      return
    }
    if (status === 'locating') return
    setMessage(null)
    setStatus('locating')
    firstFixRef.current = false
    watchRef.current = navigator.geolocation.watchPosition(onPosition, onError, {
      enableHighAccuracy: true,
      maximumAge: 10_000,
      timeout: 20_000,
    })
  }

  const label = status === 'on' ? 'Go to my location (tap again to turn off)' : status === 'locating' ? 'Finding your location…' : 'Show my location'
  return (
    <div ref={ref} className={`locate-control ${theme}`}>
      {message && (
        <div className="locate-message" role="status">
          {message}
        </div>
      )}
      <button
        type="button"
        className={`locate-btn ${status}`}
        data-guide="locate"
        onClick={handleClick}
        title={label}
        aria-label={label}
        aria-pressed={status === 'on'}
      >
        <LocateIcon size={20} />
      </button>
    </div>
  )
}

export default LocateControl
