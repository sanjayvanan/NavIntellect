import { useState, useEffect, useRef } from 'react'
import { useSelector, useDispatch } from 'react-redux'
import { useMap } from 'react-leaflet'
import { ShipTrie } from '../utils/ShipTrie'
import { setSelectedShip } from '../store/shipSlice'
import './SearchBox.css'

function SearchBox() {
  const dispatch = useDispatch()
  const map = useMap()
  const theme = useSelector((state) => state.theme.mode)
  const ships = useSelector((state) => state.ships.data || [])
  const [searchTerm, setSearchTerm] = useState('')
  const [results, setResults] = useState([])
  const [isVisible, setIsVisible] = useState(false)
  const shipTrie = useRef(new ShipTrie())
  const searchRef = useRef(null)
  const resultsRef = useRef(null)

  // Initialize ship search index
  useEffect(() => {
    if (Array.isArray(ships) && ships.length > 0) {
      shipTrie.current.clear()
      ships.forEach(ship => {
        if (ship && typeof ship === 'object' && ship.latitude && ship.longitude) {
          shipTrie.current.insert(ship)
        }
      })
    }
  }, [ships])

  // Handle click outside to close results
  useEffect(() => {
    const handleClickOutside = (event) => {
      if (searchRef.current && !searchRef.current.contains(event.target)) {
        setIsVisible(false)
      }
    }

    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  const handleSearch = (value) => {
    setSearchTerm(value)
    
    if (value.length >= 2) {
      try {
        const searchResults = shipTrie.current.search(value)
        const validResults = searchResults
          .filter(ship => ship && ship.latitude && ship.longitude)
          .slice(0, 10)
        setResults(validResults)
        setIsVisible(true)
      } catch (error) {
        console.error('Search error:', error)
        setResults([])
      }
    } else {
      setResults([])
      setIsVisible(false)
    }
  }

  const findAndOpenPopup = (ship, maxAttempts = 5) => {
    let attempts = 0;
    
    const tryOpenPopup = () => {
      attempts++;
      let found = false;
      
      map.eachLayer((layer) => {
        if (layer.getLatLng && layer.options && layer.options.icon) {
          const pos = layer.getLatLng();
          // More precise coordinate comparison
          if (Math.abs(pos.lat - ship.latitude) < 0.0001 && 
              Math.abs(pos.lng - ship.longitude) < 0.0001) {
            layer.openPopup();
            found = true;
          }
        }
      });

      // If popup wasn't found and we haven't exceeded max attempts, try again
      if (!found && attempts < maxAttempts) {
        setTimeout(tryOpenPopup, 500); // Try every 500ms
      }
    };

    // Start trying to open popup after map animation
    setTimeout(tryOpenPopup, 1000);
  };

  const handleSelect = (ship) => {
    if (!ship) return;
    
    // Use the shared ship selection handler
    window.handleShipSelect?.(ship);
    
    // Update search box
    setSearchTerm(ship.track_name?.trim() || 'Unknown Ship');
    setResults([]);
    setIsVisible(false);
  };

  return (
    <div className="search-box-wrapper" ref={searchRef}>
      <div className="search-container">
        <input
          type="text"
          value={searchTerm}
          onChange={(e) => handleSearch(e.target.value)}
          onFocus={() => setIsVisible(true)}
          placeholder="Search by MMSI or ship name..."
          className={`search-input ${theme}`}
          autoComplete="off"
        />
        {isVisible && results.length > 0 && (
          <div 
            ref={resultsRef}
            className={`search-results ${theme}`}
          >
            {results.map((ship) => (
              <div
                key={ship.uuid}
                className={`search-result-item ${theme}`}
                onClick={() => handleSelect(ship)}
              >
                <div className={`ship-name ${theme}`}>
                  {ship.track_name?.trim() || 'Unknown Ship'}
                </div>
                <div className={`ship-mmsi ${theme}`}>
                  MMSI: {ship.mmsi || 'N/A'}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

export default SearchBox 