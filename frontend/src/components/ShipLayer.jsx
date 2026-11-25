import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useMap } from 'react-leaflet'
import L from 'leaflet'
import { useSelector, useDispatch } from 'react-redux'
import { fetchShips, setSelectedShip, upsertShips, FULL_DETAIL_ZOOM } from '../store/shipSlice'
import { connectLiveSocket } from '../services/liveSocket'
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

/** Popup body for a ship (plain render function, rendered into the Leaflet popup via a portal). */
const renderShipPopup = (ship, theme) => {
  return (
    <div className={`ship-popup ${theme}`}>
      <div className="ship-header">
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

  useEffect(() => {
    window.handleShipSelect = (ship) => selectRef.current(ship)
    return () => {
      delete window.handleShipSelect
    }
  }, [])

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
  }, [dispatch, map, density, liveUpdates])

  // Popup for the selected ship, managed directly with Leaflet: opened once per selection and
  // moved with setLatLng on live updates (re-opening it every second would flicker). Its content
  // is rendered by React through a portal.
  const [popupEl] = useState(() => document.createElement('div'))
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
    return () => {
      closingOurselves = true
      popup.off('remove', onRemove)
      map.closePopup(popup)
      popupRef.current = null
    }
  }, [selectedMmsi, map, dispatch, popupEl])

  useEffect(() => {
    if (!popupRef.current || liveSelected?.latitude == null) return
    popupRef.current.setLatLng([liveSelected.latitude, liveSelected.longitude])
    popupRef.current.update()
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
      {selectedMmsi != null && createPortal(renderShipPopup(liveSelected, theme), popupEl)}
    </>
  )
}

export default ShipLayer
