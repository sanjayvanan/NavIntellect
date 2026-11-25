import { useEffect, useMemo } from 'react'
import { useMap } from 'react-leaflet'
import { useSelector, useDispatch } from 'react-redux'
import { fetchShips, setSelectedShip, upsertShips } from '../store/shipSlice'
import { connectLiveSocket } from '../services/liveSocket'
import MarkerClusterGroup from 'react-leaflet-cluster'
import { Marker, Popup, LayerGroup } from 'react-leaflet'
import L from 'leaflet'
import 'leaflet.markercluster/dist/MarkerCluster.css'
import 'leaflet.markercluster/dist/MarkerCluster.Default.css'
import SearchBox from './SearchBox'
import ShipIcon from '../assets/ShipIcon.svg?raw'
import { shipCategories } from '../config/shipCategories'

const decimalToDMS = (decimal, isLatitude) => {
  
  const direction = isLatitude 
    ? (decimal >= 0 ? "N" : "S")
    : (decimal >= 0 ? "E" : "W");
  
  const absolute = Math.abs(decimal);
  const degrees = Math.floor(absolute);
  const minutesDecimal = (absolute - degrees) * 60;
  const minutes = Math.floor(minutesDecimal);
  const seconds = ((minutesDecimal - minutes) * 60).toFixed(2);

  return `${degrees}° ${minutes}' ${seconds}" ${direction}`;
};

const formatLastReport = (timestamp) => {
  if (!timestamp) return 'No report time';
  
  const reportTime = new Date(Number(timestamp));
  const now = new Date(Date.now());
  
  const diffSeconds = Math.floor((now - reportTime) / 1000);

  // Add relative time
  let relativeTime;
  if (diffSeconds < 60) {
    relativeTime = `${diffSeconds}s ago`;
  } else if (diffSeconds < 3600) {
    relativeTime = `${Math.floor(diffSeconds / 60)}m ago`;
  } else if (diffSeconds < 86400) {
    relativeTime = `${Math.floor(diffSeconds / 3600)}h ago`;
  } else {
    relativeTime = `${Math.floor(diffSeconds / 86400)}d ago`;
  }

  return `(${relativeTime})`;
};

function ShipLayer() {
  const dispatch = useDispatch()
  const { data: ships, status, error } = useSelector((state) => state.ships)
  const selectedShip = useSelector((state) => state.ships.selectedShip)
  const theme = useSelector((state) => state.theme.mode)
  const clustering = useSelector((state) => state.theme.clustering)
  const map = useMap()

  const createShipIcon = (messageTypeId, isSelected = false, size = 8, course = 0) => {
    const category = shipCategories[messageTypeId] || shipCategories.default
    const color = isSelected ? '#f44336' : category.color

    const modifiedSvg = ShipIcon
    .replace(/fill=".*?"/g, `fill="${color}"`) // Replace the fill color
    .replace(/stroke=".*?"/g, `stroke="${color}"`); // Replace the stroke color

    return L.divIcon({
      className: 'ship-icon',
      html: `<div style="
        width: ${size}px;
        height: ${size}px;
        transform: rotate(${course - 90}deg);
        transition: all 0.3s ease;
      ">
          ${modifiedSvg}
      </div>`,
      iconSize: [size, size],
      iconAnchor: [size/2, size/2],
    })
  }

  // Reusable function to handle ship selection
  const handleShipSelect = (ship) => {
    if (!ship || !ship.latitude || !ship.longitude) return;

    // Update Redux state
    dispatch(setSelectedShip(ship));

    // Fly to ship location
    map.flyTo(
      [ship.latitude, ship.longitude],
      12,
      { duration: 1.5 }
    );

    // Find and open the popup with retries
    const findAndOpenPopup = (maxAttempts = 5) => {
      let attempts = 0;
      
      const tryOpenPopup = () => {
        attempts++;
        let found = false;
        
        map.eachLayer((layer) => {
          if (layer.getLatLng && layer.options && layer.options.icon) {
            const pos = layer.getLatLng();
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
      setTimeout(tryOpenPopup, 1600);
    };

    findAndOpenPopup();
  };

  // Export the handler for other components to use
  useEffect(() => {
    // Attach the handler to the window for other components to access
    window.handleShipSelect = handleShipSelect;
    return () => {
      delete window.handleShipSelect;
    };
  }, []);

  useEffect(() => {
    const fetchData = async () => {
      try {
        await dispatch(fetchShips()).unwrap()
      } catch (err) {
        console.error('Failed to fetch ships:', err)
      }
    }

    fetchData()
    const interval = setInterval(fetchData, 60000)  // Full refresh every 60s (fallback)
    // Live position updates pushed by the backend, merged by MMSI
    const disconnect = connectLiveSocket({ onVessels: (ships) => dispatch(upsertShips(ships)) })

    return () => {
      clearInterval(interval)
      disconnect()
    }
  }, [dispatch])

  // Effect to fly to selected ship
  useEffect(() => {
    if (selectedShip) {
      map.flyTo(
        [selectedShip.latitude, selectedShip.longitude],
        12,
        { duration: 1.5 }
      )
    }
  }, [selectedShip, map])

  // Add right-click handler to clear selection
  useEffect(() => {
    const handleRightClick = () => {
      dispatch(setSelectedShip(null))
    }

    map.on('contextmenu', handleRightClick)

    return () => {
      map.off('contextmenu', handleRightClick)
    }
  }, [map, dispatch])

  // Clear selected ship on map click
  useEffect(() => {
    const handleMapClick = () => {
      dispatch(setSelectedShip(null))
    }

    map.on('click', handleMapClick)

    return () => {
      map.off('click', handleMapClick)
    }
  }, [map, dispatch])

  const markers = useMemo(() => {
    return ships.map((ship) => {
      const isSelected = selectedShip?.uuid === ship.uuid
      const icon = createShipIcon(
        ship.message_type__id,
        isSelected,
        isSelected ? 24 : 16,
        ship.course_over_ground || 0
      )

      return (
        <Marker
          key={ship.uuid}
          position={[ship.latitude, ship.longitude]}
          icon={icon}
          zIndexOffset={isSelected ? 1000 : 0}
          eventHandlers={{
            click: () => handleShipSelect(ship)
          }}
        >
          <Popup>
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
                  <div className="detail-value">
                    {ship.course_over_ground}°
                  </div>
                </div>

                <div className="detail-row">
                  <div className="detail-label">
                    <i className="detail-icon">↗️</i>
                    <span>Heading</span>
                  </div>
                  <div className="detail-value">
                    {ship.true_heading}°
                  </div>
                </div>

                <div className="detail-row">
                  <div className="detail-label">
                    <i className="detail-icon">📍</i>
                    <span>Position</span>
                  </div>
                  <div className="detail-value coordinates">
                    <span title={`${ship.latitude.toFixed(6)}°`}>
                      {decimalToDMS(ship.latitude, true)}
                    </span>
                    <span title={`${ship.longitude.toFixed(6)}°`}>
                      {decimalToDMS(ship.longitude, false)}
                    </span>
                  </div>
                </div>

                <div className="detail-row">
                  <div className="detail-label">
                    <i className="detail-icon">🕒</i>
                    <span>Last Report</span>
                  </div>
                  <div className="detail-value timestamp">
                    {formatLastReport(ship.sensor_timestamp)}
                  </div>
                </div>
              </div>
            </div>
          </Popup>
        </Marker>
      )
    })
  }, [ships, selectedShip, theme])

  if (status === 'loading' && ships.length === 0) {
    return (
      <div className={`loading-overlay ${theme}`}>
        <div className="loading-spinner"></div>
        <div>Loading ships...</div>
      </div>
    )
  }

  if (status === 'failed') {
    return (
      <div className={`error-overlay ${theme}`}>
        <div className="error-message">
          <h3>Error Loading Ships</h3>
          <p>{error}</p>
          <button onClick={() => dispatch(fetchShips())}>
            Try Again
          </button>
        </div>
      </div>
    )
  }

  if (!ships || ships.length === 0) {
    return (
      <div className={`error-overlay ${theme}`}>
        <div className="error-message">
          <h3>No Ships Found</h3>
          <p>No ship data is currently available.</p>
          <button onClick={() => dispatch(fetchShips())}>
            Refresh
          </button>
        </div>
      </div>
    )
  }

  return (
    <>
      <SearchBox />
      {clustering ? (
        <MarkerClusterGroup
          chunkedLoading
          maxClusterRadius={50}
          spiderfyOnMaxZoom={false}
          disableClusteringAtZoom={12}
          showCoverageOnHover={true}
          zoomToBoundsOnClick={true}
          //removeOutsideVisibleBounds={true}
        >
          {markers}
        </MarkerClusterGroup>
      ) : (
        <LayerGroup>
          {markers}
        </LayerGroup>
      )}
    </>
  )
}

export default ShipLayer 