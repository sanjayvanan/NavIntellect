/* eslint-disable react/prop-types -- internal components; the project does not use PropTypes */
import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useMap } from 'react-leaflet'
import L from 'leaflet'
import { useSelector, useDispatch } from 'react-redux'
import { fetchShips, setSelectedShip, upsertShips, showTrack, hideTrack, FULL_DETAIL_ZOOM } from '../store/shipSlice'
import { alertReceived } from '../store/alertsSlice'
import { connectLiveSocket } from '../services/liveSocket'
import { getSession, refreshSession } from '../services/api'
import { TRACK_PERIODS, DEFAULT_TRACK_HOURS } from '../services/tracks'
import { boundsToBbox } from '../utils/mapBbox'
import { ShipCanvasLayer } from '../map/ShipCanvasLayer'
import { zoomToPoint } from '../map/navigation'
import SearchBox from './SearchBox'
import { DENSITY_LEVELS } from '../config/shipDensity'
import { toDMS } from '../utils/coords'

const formatLastReport = (timestamp) => {
  if (!timestamp) return 'No report time'
  const diffSeconds = Math.floor((Date.now() - Number(timestamp)) / 1000)
  let relativeTime
  if (diffSeconds < 60) relativeTime = `${diffSeconds}s ago`
  else if (diffSeconds < 3600) relativeTime = `${Math.floor(diffSeconds / 60)}m ago`
  else if (diffSeconds < 86400) relativeTime = `${Math.floor(diffSeconds / 3600)}h ago`
  else relativeTime = `${Math.floor(diffSeconds / 86400)}d ago`
  return `(${relativeTime})`
}

/** "Track history" row of the ship popup: Show track, then a period choice and Hide. */
const TrackHistoryRow = ({ ship, track, onShow, onHide }) => {
  const shown = track.mmsi === ship.mmsi
  let note = null
  if (shown && track.status === 'loading') note = 'Loading track…'
  else if (shown && track.status === 'failed') note = track.error || 'Could not load the track'
  else if (shown && track.status === 'ready')
    note = track.points ? `${track.points.toLocaleString()} positions` : 'No positions in this period'
  return (
    <div className="detail-row track-row">
      <div className="detail-label">
        <i className="detail-icon">🛤️</i>
        <span>Track</span>
      </div>
      {!shown ? (
        <button type="button" className="track-button" onClick={() => onShow(track.hours || DEFAULT_TRACK_HOURS)}>
          Show track
        </button>
      ) : (
        <div className="track-controls">
          <div className="track-periods" role="group" aria-label="Track period">
            {TRACK_PERIODS.map((p) => (
              <button
                key={p.hours}
                type="button"
                className={`track-period ${track.hours === p.hours ? 'active' : ''}`}
                aria-pressed={track.hours === p.hours}
                onClick={() => onShow(p.hours)}
              >
                {p.label}
              </button>
            ))}
            <button type="button" className="track-button subtle" onClick={onHide}>
              Hide
            </button>
          </div>
          {note && <small className={`track-note ${track.status === 'failed' ? 'error' : ''}`}>{note}</small>}
        </div>
      )}
    </div>
  )
}

/**
 * Lets the user drag a ship popup by its header, e.g. off the ship to see what is under it.
 * The popup stays attached to the ship at the dragged offset (it keeps following the live
 * position and the map), and a dashed line joins it to the ship. Double-click the header to
 * put it back. Returns a cleanup function.
 */
function makePopupDraggable(map, popup, contentEl) {
  const base = L.point(popup.options.offset)
  let drag = null
  const line = L.polyline([], { className: 'ship-popup-leader', interactive: false, weight: 1.5, dashArray: '4 4' })

  const offset = () => L.point(popup.options.offset).subtract(base)

  // Line from the ship to the nearest point of the popup box (in layer pixels, then back to lat/lng).
  const drawLine = () => {
    const container = popup.getElement()
    if (!container || !map.hasLayer(popup)) return
    if (offset().distanceTo(L.point(0, 0)) < 1) {
      line.remove()
      return
    }
    const ship = map.latLngToLayerPoint(popup.getLatLng())
    const anchor = ship.add(L.point(popup.options.offset)) // bottom centre of the popup
    const w = container.offsetWidth
    const h = container.offsetHeight
    const nearest = L.point(
      Math.min(Math.max(ship.x, anchor.x - w / 2), anchor.x + w / 2),
      Math.min(Math.max(ship.y, anchor.y - h), anchor.y),
    )
    line.setLatLngs([popup.getLatLng(), map.layerPointToLatLng(nearest)])
    if (!map.hasLayer(line)) line.addTo(map)
  }

  const setOffset = (p) => {
    popup.options.offset = [p.x, p.y]
    popup.update()
    popup.getElement()?.classList.toggle('ship-popup-moved', offset().distanceTo(L.point(0, 0)) >= 1)
    drawLine()
  }

  const onDown = (e) => {
    const header = e.target.closest?.('.ship-header')
    if (!header || e.button > 0 || e.target.closest('button, a, input')) return
    e.preventDefault()
    header.setPointerCapture?.(e.pointerId)
    drag = { header, start: L.point(e.clientX, e.clientY), from: L.point(popup.options.offset) }
    popup.getElement()?.classList.add('ship-popup-dragging')
  }
  const onMove = (e) => {
    if (!drag) return
    setOffset(drag.from.add(L.point(e.clientX, e.clientY).subtract(drag.start)))
  }
  const onUp = (e) => {
    if (!drag) return
    drag.header.releasePointerCapture?.(e.pointerId)
    drag = null
    popup.getElement()?.classList.remove('ship-popup-dragging')
  }
  const onDblClick = (e) => {
    if (e.target.closest?.('.ship-header')) setOffset(base)
  }

  contentEl.addEventListener('pointerdown', onDown)
  contentEl.addEventListener('pointermove', onMove)
  contentEl.addEventListener('pointerup', onUp)
  contentEl.addEventListener('pointercancel', onUp)
  contentEl.addEventListener('dblclick', onDblClick)
  map.on('zoomend viewreset', drawLine)
  popup.on('moved', drawLine)
  popup.on('remove', () => line.remove())

  return () => {
    contentEl.removeEventListener('pointerdown', onDown)
    contentEl.removeEventListener('pointermove', onMove)
    contentEl.removeEventListener('pointerup', onUp)
    contentEl.removeEventListener('pointercancel', onUp)
    contentEl.removeEventListener('dblclick', onDblClick)
    map.off('zoomend viewreset', drawLine)
    popup.off('moved', drawLine)
    line.remove()
  }
}

/** Popup body for a ship (plain render function, rendered into the Leaflet popup via a portal). */
const renderShipPopup = (ship, theme, trackRow) => {
  return (
    <div className={`ship-popup ${theme}`}>
      <div className="ship-header" title="Drag to move · double-click to put back">
        <div className="ship-title">
          <h3>{ship.track_name}</h3>
          <span className="ship-type">{ship.type || 'Vessel'}</span>
        </div>
        <div className="ship-status-indicator"></div>
      </div>

      <div className="ship-details">
        <div className="detail-row">
          <div className="detail-label">
            <i className="detail-icon">🔢</i>
            <span>MMSI</span>
          </div>
          <div className="detail-value">{ship.mmsi}</div>
        </div>

        <div className="detail-row">
          <div className="detail-label">
            <i className="detail-icon">⚡</i>
            <span>Speed</span>
          </div>
          <div className="detail-value highlight">
            {ship.speed_over_ground} <small>knots</small>
          </div>
        </div>

        <div className="detail-row">
          <div className="detail-label">
            <i className="detail-icon">🧭</i>
            <span>Course</span>
          </div>
          <div className="detail-value">{ship.course_over_ground}°</div>
        </div>

        <div className="detail-row">
          <div className="detail-label">
            <i className="detail-icon">↗️</i>
            <span>Heading</span>
          </div>
          <div className="detail-value">{ship.true_heading}°</div>
        </div>

        <div className="detail-row">
          <div className="detail-label">
            <i className="detail-icon">📍</i>
            <span>Position</span>
          </div>
          <div className="detail-value coordinates">
            <span title={`${ship.latitude.toFixed(6)}°`}>{toDMS(ship.latitude, true)}</span>
            <span title={`${ship.longitude.toFixed(6)}°`}>{toDMS(ship.longitude, false)}</span>
          </div>
        </div>

        <div className="detail-row">
          <div className="detail-label">
            <i className="detail-icon">🕒</i>
            <span>Last Report</span>
          </div>
          <div className="detail-value timestamp">{formatLastReport(ship.sensor_timestamp)}</div>
        </div>

        {trackRow}
      </div>
    </div>
  )
}

/**
 * Ships on the map. Performance model:
 * - Level of detail: zoomed out, the server returns one representative ship per grid cell;
 *   from FULL_DETAIL_ZOOM on, every ship in view. The cell size is the "Ship density" setting
 *   in the sidebar (levels in config/shipDensity.js), up to "All ships" (no thinning).
 * - Rendering: one canvas for all ships (no DOM marker per ship).
 * - Data: refetched for the viewport after every pan/zoom (debounced), live WebSocket updates
 *   limited to the viewport.
 */
function ShipLayer() {
  const dispatch = useDispatch()
  const { data: ships, status, error } = useSelector((state) => state.ships)
  const selectedShip = useSelector((state) => state.ships.selectedShip)
  const theme = useSelector((state) => state.theme.mode)
  const track = useSelector((state) => state.ships.track)
  const userId = useSelector((state) => state.auth.user?.id ?? null)
  const { shipDensity: densityLevel, clustering, shipSize, showLabels, liveUpdates } = useSelector((state) => state.theme)
  const density = DENSITY_LEVELS[densityLevel]?.density ?? null // null = all ships
  const map = useMap()
  const layerRef = useRef(null)
  const selectedRef = useRef(selectedShip)
  selectedRef.current = selectedShip

  // Selecting a ship (map click, search, other components via window.handleShipSelect).
  const selectShip = (ship) => {
    if (!ship || ship.latitude == null || ship.longitude == null) return
    dispatch(setSelectedShip(ship))
    zoomToPoint(map, [ship.latitude, ship.longitude], Math.max(map.getZoom(), 12))
  }
  const selectRef = useRef(selectShip)
  selectRef.current = selectShip

  // Opening a ship by MMSI (notifications): select it if it is loaded, otherwise go to where it
  // was reported and select it once the ships of that area have loaded.
  const pendingFocusRef = useRef(null)
  const focusShip = (mmsi, lat, lon) => {
    const ship = ships.find((s) => s.mmsi === mmsi)
    if (ship) return selectShip(ship)
    if (lat == null || lon == null) return
    pendingFocusRef.current = mmsi
    zoomToPoint(map, [lat, lon], Math.max(map.getZoom(), 12))
  }
  const focusRef = useRef(focusShip)
  focusRef.current = focusShip

  useEffect(() => {
    window.handleShipSelect = (ship) => selectRef.current(ship)
    window.handleShipFocus = (mmsi, lat, lon) => focusRef.current(mmsi, lat, lon)
    return () => {
      delete window.handleShipSelect
      delete window.handleShipFocus
    }
  }, [])

  useEffect(() => {
    if (pendingFocusRef.current == null) return
    const ship = ships.find((s) => s.mmsi === pendingFocusRef.current)
    if (!ship) return
    pendingFocusRef.current = null
    dispatch(setSelectedShip(ship))
  }, [ships, dispatch])

  // One canvas layer for all ships.
  useEffect(() => {
    const layer = new ShipCanvasLayer({
      onSelect: (ship) => selectRef.current(ship),
      onEmptyClick: () => dispatch(setSelectedShip(null)),
    })
    layer.addTo(map)
    layerRef.current = layer
    layer.setDisplay(displayRef.current)
    const clear = () => dispatch(setSelectedShip(null))
    map.on('contextmenu', clear)
    return () => {
      map.off('contextmenu', clear)
      layer.remove()
      layerRef.current = null
    }
  }, [map, dispatch])

  // Display settings from the Settings panel / toolbar.
  const displayRef = useRef(null)
  displayRef.current = { clustering, size: shipSize, labels: showLabels, dark: theme === 'dark' }
  useEffect(() => {
    layerRef.current?.setDisplay({ clustering, size: shipSize, labels: showLabels, dark: theme === 'dark' })
  }, [clustering, shipSize, showLabels, theme])

  // Live copy of the selected ship (positions keep updating while its popup is open).
  const liveSelected = selectedShip ? ships.find((s) => s.mmsi === selectedShip.mmsi) || selectedShip : null

  useEffect(() => {
    layerRef.current?.setData(ships, liveSelected)
  }, [ships, liveSelected])

  // Ships for the visible area at the current level of detail: on load, after every pan/zoom
  // (debounced) and every 60s as a fallback.
  useEffect(() => {
    const view = () => ({
      bbox: boundsToBbox(map.getBounds()),
      // "All ships" -> ask for full detail at any zoom.
      zoom: density != null ? map.getZoom() : FULL_DETAIL_ZOOM,
      density,
    })
    const fullDetail = () => density == null || map.getZoom() >= FULL_DETAIL_ZOOM
    const fetchData = () => {
      dispatch(fetchShips(view()))
        .unwrap()
        .catch((err) => {
          if (err !== 'Aborted') console.error('Failed to fetch ships:', err)
        })
    }
    // Live updates can be switched off in Settings (then only the 60 s refresh runs).
    const socket = liveUpdates
      ? connectLiveSocket({
          bbox: view().bbox,
          // Signed in, the server also sends alerts of the user's own zones.
          getToken: () => getSession()?.access_token ?? null,
          refreshToken: async (stale) => (await refreshSession(stale))?.access_token ?? null,
          onAlert: (alert) => dispatch(alertReceived(alert)),
          // Zoomed out, only refresh the representative ships already shown.
          onVessels: (updates) => dispatch(upsertShips({ ships: updates, addNew: fullDetail() })),
        })
      : { setBbox() {}, close() {} }

    let debounce = null
    const onMoveEnd = () => {
      clearTimeout(debounce)
      debounce = setTimeout(() => {
        socket.setBbox(view().bbox)
        fetchData()
      }, 250)
    }

    fetchData()
    map.on('moveend', onMoveEnd)
    const interval = setInterval(fetchData, 60000)
    return () => {
      clearInterval(interval)
      clearTimeout(debounce)
      map.off('moveend', onMoveEnd)
      socket.close()
    }
    // userId: reconnect as the new user after signing in or out.
  }, [dispatch, map, density, liveUpdates, userId])

  // Popup for the selected ship, managed directly with Leaflet: opened once per selection and
  // moved with setLatLng on live updates (re-opening it every second would flicker). Its content
  // is rendered by React through a portal.
  const [popupEl] = useState(() => {
    const el = document.createElement('div')
    // Leaflet ignores clicks inside a popup by walking up from the clicked element, but a popup
    // button that React replaces on click (Show track -> period buttons) is already detached by
    // then, so the click would reach the map: close the popup and select the ship underneath.
    // Mark such targets before the click bubbles (Leaflet skips targets with this flag).
    el.addEventListener('click', (e) => (e.target._leaflet_disable_events = true), true)
    return el
  })
  const popupRef = useRef(null)
  const selectedMmsi = liveSelected?.latitude != null ? liveSelected.mmsi : null

  useEffect(() => {
    if (selectedMmsi == null) return
    const s = selectedRef.current
    const popup = L.popup({ offset: [0, -10], autoPan: false, maxWidth: 320 })
      .setLatLng([s.latitude, s.longitude])
      .setContent(popupEl)
      .openOn(map)
    let closingOurselves = false
    // The user closed it (X button or click on empty map): clear the selection.
    const onRemove = () => {
      if (!closingOurselves) dispatch(setSelectedShip(null))
    }
    popup.on('remove', onRemove)
    popupRef.current = popup
    const stopDragging = makePopupDraggable(map, popup, popupEl)
    // Bring the whole popup into view once when it opens (Leaflet's autoPan is off because it
    // would pan again on every live update). Runs after React has filled the popup and again when
    // a zoom to the ship (search, copilot, notifications) finishes.
    const fitPopup = () => {
      const box = popup.getElement()?.getBoundingClientRect()
      const view = map.getContainer().getBoundingClientRect()
      if (!box || !map.hasLayer(popup)) return
      const pad = 16
      const top = 72 // the search box floats over the top of the map
      const dx = box.left < view.left + pad ? box.left - view.left - pad : box.right > view.right - pad ? box.right - view.right + pad : 0
      const dy = box.top < view.top + top ? box.top - view.top - top : box.bottom > view.bottom - pad ? box.bottom - view.bottom + pad : 0
      if (dx || dy) map.panBy([dx, dy])
    }
    const frame = requestAnimationFrame(fitPopup)
    const fitAfterMove = () => requestAnimationFrame(fitPopup) // no-op once the popup is in view
    map.on('moveend', fitAfterMove)
    map.on('shippopup:fit', fitAfterMove) // e.g. after the map zooms out to show the ship's track
    const stopFitting = setTimeout(() => map.off('moveend', fitAfterMove), 3000)
    return () => {
      closingOurselves = true
      cancelAnimationFrame(frame)
      clearTimeout(stopFitting)
      map.off('moveend', fitAfterMove)
      map.off('shippopup:fit', fitAfterMove)
      stopDragging()
      popup.off('remove', onRemove)
      map.closePopup(popup)
      popupRef.current = null
    }
  }, [selectedMmsi, map, dispatch, popupEl])

  useEffect(() => {
    if (!popupRef.current || liveSelected?.latitude == null) return
    popupRef.current.setLatLng([liveSelected.latitude, liveSelected.longitude])
    popupRef.current.update()
    popupRef.current.fire('moved') // keeps the leader line of a dragged popup on the ship
  }, [liveSelected])

  return (
    <>
      <SearchBox />
      {status === 'loading' && ships.length === 0 && (
        <div className={`loading-overlay ${theme}`}>
          <div className="loading-spinner"></div>
          <div>Loading ships...</div>
        </div>
      )}
      {status === 'failed' && ships.length === 0 && (
        <div className={`error-overlay ${theme}`}>
          <div className="error-message">
            <h3>Error Loading Ships</h3>
            <p>{error}</p>
            <button onClick={() => dispatch(fetchShips({ bbox: boundsToBbox(map.getBounds()), zoom: map.getZoom(), density }))}>
              Try Again
            </button>
          </div>
        </div>
      )}
      {selectedMmsi != null &&
        createPortal(
          renderShipPopup(
            liveSelected,
            theme,
            <TrackHistoryRow
              ship={liveSelected}
              track={track}
              onShow={(hours) => dispatch(showTrack({ mmsi: liveSelected.mmsi, hours }))}
              onHide={() => dispatch(hideTrack())}
            />,
          ),
          popupEl,
        )}
    </>
  )
}

export default ShipLayer
