/* eslint-disable react/prop-types -- internal component; the project does not use PropTypes */
import { useEffect, useMemo, useRef, useState } from 'react'
import { useDispatch, useSelector } from 'react-redux'
import { useMap } from 'react-leaflet'
import L from 'leaflet'
import { apiFetch } from '../services/api'
import { upsertShips } from '../store/shipSlice'
import { OBJECT_TYPES, objectTypeOf } from '../features/mapObjects'
import { timeAgo } from '../utils/alertText'
import { CloseIcon, SearchIcon } from './Icons'
import './TrackInfoPanel.css'
import { isPhoneLayout } from '../utils/alertText'

const PAGE = 50
const DEBOUNCE_MS = 250
const SORTS = [
  { id: 'recent', label: 'Latest' },
  { id: 'name', label: 'Name' },
  { id: 'speed', label: 'Speed' },
]
// Order of the shape groups in the area filter.
const SHAPE_ORDER = ['polygon', 'rectangle', 'circle']

const fmt = (n) => n.toLocaleString()

/** GET /api/vessels/browse: { total, vessels } for one page. */
function browseShips({ q, zoneId, sort, offset }, signal) {
  const params = new URLSearchParams({ sort, offset: String(offset), limit: String(PAGE) })
  if (q) params.set('q', q)
  if (zoneId) params.set('zone_id', zoneId)
  return apiFetch(`/api/vessels/browse?${params}`, { signal })
}

/**
 * Track info (sidebar): every ship heard in the last 50 h (the same ships the map can show),
 * with the total count, the same search as the search box (name, MMSI, IMO, callsign), and a
 * filter to the ships inside one of the zones drawn under Graphical objects.
 * Clicking a ship opens it on the map.
 */
function TrackInfoPanel({ style, theme, onClose }) {
  const dispatch = useDispatch()
  const map = useMap()
  const zones = useSelector((state) => state.zones.items)
  const selectedMmsi = useSelector((state) => state.ships.selectedShip?.mmsi ?? null)
  const ref = useRef(null)

  const [text, setText] = useState('')
  const [q, setQ] = useState('')
  const [zoneId, setZoneId] = useState('')
  const [sort, setSort] = useState('recent')
  const [vessels, setVessels] = useState([])
  const [total, setTotal] = useState(null)
  const [status, setStatus] = useState('loading') // loading | more | ready | failed
  const [error, setError] = useState(null)
  const [reload, setReload] = useState(0)
  const moreRef = useRef(null) // in-flight "Load more"

  useEffect(() => {
    L.DomEvent.disableClickPropagation(ref.current)
    L.DomEvent.disableScrollPropagation(ref.current)
  }, [])

  // Filters asked for by the AI copilot (also when the panel is already open).
  const request = useSelector((state) => state.copilot.shipListRequest)
  useEffect(() => {
    // Only a request made just now: opening the panel later by hand starts unfiltered.
    if (!request || Date.now() - request.at > 3000) return
    setText(request.query ?? '')
    setQ(request.query ?? '')
    setZoneId(request.zone_id ?? '')
    setSort(request.sort ?? 'recent')
  }, [request])

  // Search text -> query, debounced.
  useEffect(() => {
    const t = setTimeout(() => setQ(text.trim()), DEBOUNCE_MS)
    return () => clearTimeout(t)
  }, [text])

  // A zone that was deleted (or hidden by signing out) cannot stay selected.
  const zone = zones.find((z) => z.id === zoneId) ?? null
  useEffect(() => {
    if (zoneId && zones.length && !zone) setZoneId('')
  }, [zoneId, zones, zone])

  // First page whenever the search, area or order changes. Older requests are cancelled.
  useEffect(() => {
    const controller = new AbortController()
    moreRef.current?.abort()
    setStatus('loading')
    setError(null)
    browseShips({ q, zoneId, sort, offset: 0 }, controller.signal)
      .then((res) => {
        setVessels(res.vessels)
        setTotal(res.total)
        setStatus('ready')
      })
      .catch((err) => {
        if (err.name === 'AbortError') return
        setStatus('failed')
        setError(err.message || 'Could not load ships')
      })
    return () => controller.abort()
  }, [q, zoneId, sort, reload])

  const loadMore = () => {
    const controller = new AbortController()
    moreRef.current = controller
    setStatus('more')
    browseShips({ q, zoneId, sort, offset: vessels.length }, controller.signal)
      .then((res) => {
        setVessels((prev) => {
          const seen = new Set(prev.map((v) => v.mmsi))
          return [...prev, ...res.vessels.filter((v) => !seen.has(v.mmsi))]
        })
        setTotal(res.total)
        setStatus('ready')
      })
      .catch((err) => {
        if (err.name === 'AbortError') return
        setStatus('failed')
        setError(err.message || 'Could not load ships')
      })
  }

  // Zones grouped by shape, for the area filter.
  const zoneGroups = useMemo(() => {
    const groups = new Map(SHAPE_ORDER.map((id) => [id, []]))
    for (const z of zones) groups.get(objectTypeOf(z).id)?.push(z)
    return SHAPE_ORDER.map((id) => ({ type: OBJECT_TYPES[id], zones: groups.get(id).sort((a, b) => a.properties.name.localeCompare(b.properties.name)) })).filter(
      (g) => g.zones.length,
    )
  }, [zones])

  const openShip = (ship) => {
    if (ship.latitude == null || ship.longitude == null) return
    dispatch(upsertShips([ship])) // make sure it is on the map even if outside the loaded area
    window.handleShipSelect?.(ship)
    if (isPhoneLayout()) onClose() // on a phone the panel would hide the ship and its popup
  }

  const zoomToZone = () => {
    if (!zone) return
    const bounds = L.geoJSON(zone).getBounds()
    if (bounds.isValid()) map.fitBounds(bounds, { padding: [40, 40] })
  }

  const loading = status === 'loading'
  // "<n> ships in Singapore Strait" / "match “maersk”" / "in the last 50 h"
  const shipsWord = total === 1 ? 'ship' : 'ships'
  const scope = zone ? `in ${zone.properties.name}` : 'in the last 50 h'
  const summary = q ? `${shipsWord} match “${q}” ${zone ? scope : ''}` : `${shipsWord} ${scope}`

  return (
    <div ref={ref} className={`layer-control-panel track-info-panel ${theme}`} style={style} data-guide-panel="ships">
      <div className="panel-header">
        <span>Track info</span>
        <button className="panel-close" onClick={onClose} aria-label="Close">
          <CloseIcon size={16} />
        </button>
      </div>

      <div className="ti-total" aria-live="polite">
        <strong>{total == null ? '…' : fmt(total)}</strong>
        <span>{summary}</span>
      </div>

      <label className="ti-search" data-guide="ships.search">
        <SearchIcon size={16} />
        <input
          type="search"
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Search ships: name, MMSI, IMO, callsign"
          aria-label="Search ships"
        />
      </label>

      <div className="ti-filters">
        <label className="ti-field">
          <span>Area</span>
          <select value={zoneId} data-guide="ships.area" onChange={(e) => setZoneId(e.target.value)}>
            <option value="">All ships</option>
            {zoneGroups.map((g) => (
              <optgroup key={g.type.id} label={g.type.plural}>
                {g.zones.map((z) => (
                  <option key={z.id} value={z.id}>
                    {z.properties.name}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
        </label>
        <label className="ti-field">
          <span>Sort</span>
          <select value={sort} data-guide="ships.sort" onChange={(e) => setSort(e.target.value)}>
            {SORTS.map((s) => (
              <option key={s.id} value={s.id}>
                {s.label}
              </option>
            ))}
          </select>
        </label>
      </div>
      {zone && (
        <div className="ti-zone">
          <span>
            Ships inside this {objectTypeOf(zone).label.toLowerCase()} now
          </span>
          <button type="button" onClick={zoomToZone}>
            Show on map
          </button>
          <button type="button" onClick={() => setZoneId('')}>
            Clear
          </button>
        </div>
      )}
      {!zones.length && <p className="ti-hint">Draw a zone under Graphical objects to filter the ships inside it.</p>}

      <div className={`ti-list ${loading ? 'busy' : ''}`} data-guide="ships.list">
        {status === 'failed' && (
          <div className="ti-empty">
            <p>{error}</p>
            <button type="button" onClick={() => setReload((n) => n + 1)}>
              Try again
            </button>
          </div>
        )}
        {status !== 'failed' && !loading && vessels.length === 0 && (
          <div className="ti-empty">{zone ? 'No ships inside this area right now.' : 'No ships found.'}</div>
        )}
        {loading && vessels.length === 0 && <div className="ti-empty">Loading ships…</div>}
        <ul>
          {vessels.map((v) => (
            <li key={v.mmsi}>
              <button
                type="button"
                className={`ti-row ${v.mmsi === selectedMmsi ? 'selected' : ''}`}
                onClick={() => openShip(v)}
                title="Show this ship on the map"
              >
                <span className="ti-main">
                  <span className="ti-name">{v.track_name?.trim() || `MMSI ${v.mmsi}`}</span>
                  <span className="ti-sub">
                    {v.type} · {v.mmsi}
                    {v.destination ? ` · → ${v.destination}` : ''}
                  </span>
                </span>
                <span className="ti-side">
                  <span className="ti-speed">{Number(v.speed_over_ground).toFixed(1)} kn</span>
                  <span className="ti-seen">{v.sensor_timestamp ? timeAgo(v.sensor_timestamp) : ''}</span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      </div>

      {total != null && vessels.length > 0 && (
        <div className="ti-footer">
          <span>
            Showing {fmt(vessels.length)} of {fmt(total)}
          </span>
          {vessels.length < total && (
            <button type="button" onClick={loadMore} disabled={status === 'more' || loading}>
              {status === 'more' ? 'Loading…' : 'Load more'}
            </button>
          )}
        </div>
      )}
    </div>
  )
}

export default TrackInfoPanel
