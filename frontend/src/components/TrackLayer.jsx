import { useEffect, useRef } from 'react'
import { useMap } from 'react-leaflet'
import { useDispatch, useSelector } from 'react-redux'
import L from 'leaflet'
import { trackStatus } from '../store/shipSlice'
import { fetchTrack, trackToLatLngs } from '../services/tracks'

const COLOR = '#f97316'
const REFRESH_MS = 60_000
const MAX_DOTS = 600 // hover dots along the line (the line itself keeps every point)

/** "47 min" / "2 h 5 min" */
const formatGap = (minutes) => (minutes < 60 ? `${minutes} min` : `${Math.floor(minutes / 60)} h${minutes % 60 ? ` ${minutes % 60} min` : ''}`)

const formatTime = (ms) =>
  new Date(ms).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })

/**
 * Track history of the selected ship (Show track in its popup): the line for the chosen period,
 * a marker where it starts and dots that show the time on hover. Drawn in its own pane just
 * under the ships. Refetched every minute so the line keeps up with the ship.
 */
function TrackLayer() {
  const map = useMap()
  const dispatch = useDispatch()
  const { mmsi, hours } = useSelector((state) => state.ships.track)
  const dark = useSelector((state) => state.theme.mode === 'dark')
  const darkRef = useRef(dark) // read at draw time: a theme change should not refetch the track
  darkRef.current = dark

  useEffect(() => {
    if (!map.getPane('track')) {
      const pane = map.createPane('track')
      pane.style.zIndex = 440 // under the ship canvas (450), above zones and tiles
    }
  }, [map])

  useEffect(() => {
    if (mmsi == null) return
    let cancelled = false
    let fitted = false
    // SVG (not canvas): only the hover dots take the mouse, so zones under the track stay clickable.
    const renderer = L.svg({ pane: 'track', padding: 0.5 })
    const group = L.layerGroup().addTo(map)

    const draw = (feature) => {
      const { segments, gaps, points } = trackToLatLngs(feature)
      group.clearLayers()
      if (!points.length) return 0
      // Gaps in reception: a thin dashed straight line, since the real route there is unknown.
      for (const g of gaps) {
        L.polyline([g.from, g.to], { pane: 'track', renderer, color: darkRef.current ? '#111827' : '#ffffff', weight: 5, opacity: 0.55, dashArray: '8 8', lineCap: 'butt', interactive: false }).addTo(group)
        L.polyline([g.from, g.to], { pane: 'track', renderer, color: COLOR, weight: 2.5, opacity: 0.9, dashArray: '8 8', lineCap: 'butt' })
          .bindTooltip(`No position reports for ${formatGap(g.minutes)} · the real route here is unknown`, { sticky: true })
          .addTo(group)
      }
      for (const seg of segments) {
        if (seg.length < 2) continue
        // White halo under the coloured line keeps it readable on any base map.
        L.polyline(seg, { pane: 'track', renderer, color: darkRef.current ? '#111827' : '#ffffff', weight: 6, opacity: 0.7, interactive: false }).addTo(group)
        L.polyline(seg, { pane: 'track', renderer, color: COLOR, weight: 3, opacity: 0.95, interactive: false }).addTo(group)
      }
      const step = Math.max(1, Math.ceil(points.length / MAX_DOTS))
      for (let i = 0; i < points.length; i += step) {
        const p = points[i]
        if (p.time == null) continue
        L.circleMarker([p.lat, p.lng], { pane: 'track', renderer, radius: 3, color: COLOR, weight: 1, fillColor: '#fff', fillOpacity: 0.9 })
          .bindTooltip(formatTime(p.time), { direction: 'top', offset: [0, -4] })
          .addTo(group)
      }
      const start = points[0]
      L.circleMarker([start.lat, start.lng], { pane: 'track', renderer, radius: 6, color: '#fff', weight: 2, fillColor: COLOR, fillOpacity: 1 })
        .bindTooltip(start.time != null ? `Track start · ${formatTime(start.time)}` : 'Track start', { direction: 'top', offset: [0, -6] })
        .addTo(group)

      // First draw only: bring the track into view if part of it is off screen.
      if (!fitted) {
        fitted = true
        const bounds = L.latLngBounds(points.map((p) => [p.lat, p.lng]))
        if (bounds.isValid() && !map.getBounds().contains(bounds)) {
          // Then let the ship popup move back into view (see ShipLayer: 'shippopup:fit').
          map.once('moveend', () => map.fire('shippopup:fit'))
          map.fitBounds(bounds, { padding: [60, 60], maxZoom: 13 })
        }
      }
      return points.length
    }

    const load = async () => {
      try {
        const feature = await fetchTrack(mmsi, hours)
        if (cancelled) return
        dispatch(trackStatus({ mmsi, status: 'ready', points: draw(feature) }))
      } catch (err) {
        if (cancelled) return
        dispatch(trackStatus({ mmsi, status: 'failed', error: err.message || 'Could not load the track' }))
      }
    }

    dispatch(trackStatus({ mmsi, status: 'loading' }))
    load()
    const timer = setInterval(load, REFRESH_MS)
    return () => {
      cancelled = true
      clearInterval(timer)
      map.removeLayer(group)
      if (map.hasLayer(renderer)) map.removeLayer(renderer)
    }
  }, [map, dispatch, mmsi, hours])

  return null
}

export default TrackLayer
