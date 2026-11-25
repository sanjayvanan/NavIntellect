import { useState, useEffect, useRef } from 'react'
import { useSelector, useDispatch } from 'react-redux'
import { API_BASE_URL, upsertShips } from '../store/shipSlice'
import './SearchBox.css'

const MIN_CHARS = 2
const DEBOUNCE_MS = 250

const timeAgo = (ms) => {
  if (!ms) return 'never seen'
  const s = Math.max(0, Math.floor((Date.now() - ms) / 1000))
  if (s < 60) return `${s}s ago`
  if (s < 3600) return `${Math.floor(s / 60)}m ago`
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`
  return `${Math.floor(s / 86400)}d ago`
}

/**
 * Searches every vessel the backend knows (name, MMSI, IMO, callsign), not just the ships
 * currently loaded on the map. Selecting a result adds it to the map and flies to it.
 */
function SearchBox() {
  const dispatch = useDispatch()
  const theme = useSelector((state) => state.theme.mode)
  const [searchTerm, setSearchTerm] = useState('')
  const [results, setResults] = useState([])
  const [isVisible, setIsVisible] = useState(false)
  const [loading, setLoading] = useState(false)
  const [active, setActive] = useState(-1)
  const searchRef = useRef(null)

  // Debounced server search; an in-flight request is aborted when the user keeps typing.
  useEffect(() => {
    const q = searchTerm.trim()
    if (q.length < MIN_CHARS) {
      setResults([])
      setLoading(false)
      return
    }
    const controller = new AbortController()
    const timer = setTimeout(async () => {
      setLoading(true)
      try {
        const params = new URLSearchParams({ q, limit: '10' })
        const res = await fetch(`${API_BASE_URL}/api/vessels?${params}`, { signal: controller.signal })
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        setResults(await res.json())
        setActive(-1)
      } catch (error) {
        if (error.name !== 'AbortError') {
          console.error('Search error:', error)
          setResults([])
        }
      } finally {
        if (!controller.signal.aborted) setLoading(false)
      }
    }, DEBOUNCE_MS)
    return () => {
      clearTimeout(timer)
      controller.abort()
    }
  }, [searchTerm])

  // Close results when clicking outside
  useEffect(() => {
    const handleClickOutside = (event) => {
      if (searchRef.current && !searchRef.current.contains(event.target)) {
        setIsVisible(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  const hasPosition = (ship) => ship.latitude != null && ship.longitude != null

  const handleSelect = (ship) => {
    if (!ship || !hasPosition(ship)) return
    // Make sure the marker exists even if the ship is outside the area loaded on the map.
    dispatch(upsertShips([ship]))
    window.handleShipSelect?.(ship)
    setSearchTerm(ship.track_name?.trim() || 'Unknown Ship')
    setResults([])
    setIsVisible(false)
  }

  const handleKeyDown = (e) => {
    if (!results.length) return
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActive((i) => (i + 1) % results.length)
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActive((i) => (i <= 0 ? results.length - 1 : i - 1))
    } else if (e.key === 'Enter') {
      handleSelect(results[active >= 0 ? active : 0])
    } else if (e.key === 'Escape') {
      setIsVisible(false)
    }
  }

  const q = searchTerm.trim()
  const showEmpty = isVisible && !loading && q.length >= MIN_CHARS && results.length === 0

  return (
    <div className="search-box-wrapper" ref={searchRef}>
      <div className="search-container">
        <input
          type="text"
          value={searchTerm}
          onChange={(e) => {
            setSearchTerm(e.target.value)
            setIsVisible(true)
          }}
          onFocus={() => setIsVisible(true)}
          onKeyDown={handleKeyDown}
          placeholder="Search ships worldwide: name, MMSI, IMO, callsign..."
          className={`search-input ${theme}`}
          autoComplete="off"
        />
        {isVisible && (results.length > 0 || showEmpty) && (
          <div className={`search-results ${theme}`}>
            {results.map((ship, i) => {
              const located = hasPosition(ship)
              return (
                <div
                  key={ship.uuid}
                  className={`search-result-item ${theme} ${i === active ? 'active' : ''} ${located ? '' : 'disabled'}`}
                  onClick={() => handleSelect(ship)}
                  onMouseEnter={() => setActive(i)}
                  title={located ? 'Show on map' : 'No position received yet'}
                >
                  <div className={`ship-name ${theme}`}>{ship.track_name?.trim() || 'Unknown Ship'}</div>
                  <div className={`ship-mmsi ${theme}`}>
                    {ship.type} · MMSI {ship.mmsi}
                    {ship.imo ? ` · IMO ${ship.imo}` : ''}
                    {' · '}
                    {located ? timeAgo(ship.last_seen) : 'no position yet'}
                  </div>
                </div>
              )
            })}
            {showEmpty && <div className={`search-result-item ${theme} disabled`}>No ships found</div>}
          </div>
        )}
      </div>
    </div>
  )
}

export default SearchBox
