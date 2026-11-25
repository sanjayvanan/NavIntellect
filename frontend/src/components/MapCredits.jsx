import { useEffect, useRef, useState } from 'react'
import { useSelector } from 'react-redux'
import { useMap } from 'react-leaflet'
import { baseLayers, overlayLayers } from '../config/mapLayers'

/**
 * Data credits of the active map layers, behind a small "© Map data" button in the status bar.
 * The tile providers (OpenStreetMap, Esri, CARTO, OpenSeaMap) require their attribution to be
 * reachable on the map; this replaces Leaflet's corner control, which overlapped the zoom buttons.
 * Opens on click (never on hover, so it can't get stuck open); closes on a second click, Esc,
 * a click elsewhere or when the map moves.
 */
function MapCredits() {
  const map = useMap()
  const baseName = useSelector((s) => s.theme.baseLayer)
  const overlays = useSelector((s) => s.theme.overlays)
  const [open, setOpen] = useState(false)
  const ref = useRef(null)

  // Attribution strings come from our own static layer config (trusted HTML with links).
  const credits = [
    baseLayers.find((l) => l.name === baseName) ?? baseLayers[0],
    ...overlayLayers.filter((o) => overlays.includes(o.name)),
  ].map((l) => ({ name: l.name, html: l.attribution }))

  useEffect(() => {
    if (!open) return
    const close = () => setOpen(false)
    const onDown = (e) => {
      if (!ref.current?.contains(e.target)) close()
    }
    const onKey = (e) => e.key === 'Escape' && close()
    document.addEventListener('pointerdown', onDown, true)
    document.addEventListener('keydown', onKey)
    map.on('movestart', close)
    return () => {
      document.removeEventListener('pointerdown', onDown, true)
      document.removeEventListener('keydown', onKey)
      map.off('movestart', close)
    }
  }, [open, map])

  return (
    <div ref={ref} className="map-credits">
      <button type="button" className={`map-credits-btn ${open ? 'on' : ''}`} onClick={() => setOpen((v) => !v)} aria-expanded={open}>
        © Map data
      </button>
      {open && (
        <div className="map-credits-pop" role="dialog" aria-label="Map data credits">
          {credits.map((c) => (
            <p key={c.name}>
              <strong>{c.name}</strong>
              <span dangerouslySetInnerHTML={{ __html: c.html }} />
            </p>
          ))}
          <p className="map-credits-lib">
            Map library: <a href="https://leafletjs.com" target="_blank" rel="noreferrer">Leaflet</a>
          </p>
        </div>
      )}
    </div>
  )
}

export default MapCredits
