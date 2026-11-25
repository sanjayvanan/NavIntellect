import { useState, useEffect } from 'react'
import { useSelector } from 'react-redux'
import { useMap } from 'react-leaflet'
import L from 'leaflet'
import { baseLayers, overlayLayers } from '../config/mapLayers'
import './Sidebar.css'

const sidebarButtons = [
  { 
    id: 'mapType', 
    icon: '🗺️', 
    label: 'Map Type',
    panel: 'layerControl' 
  },
  { id: 'objects', icon: '📍', label: 'Graphical Objects' },
  { id: 'settings', icon: '⚙️', label: 'Settings' },
  { id: 'routes', icon: '🛣️', label: 'Routes' },
  { id: 'notifications', icon: '🔔', label: 'Notifications' },
  { id: 'trackInfo', icon: '📊', label: 'Track Info' }
]

function Sidebar() {
  const theme = useSelector((state) => state.theme.mode)
  const [showLayerControl, setShowLayerControl] = useState(false)
  const [activeLayer, setActiveLayer] = useState(baseLayers[0].name)
  const [activeOverlays, setActiveOverlays] = useState({})
  const [buttonPosition, setButtonPosition] = useState({ top: 0 })
  const map = useMap()

  // Initialize first base layer on mount
  useEffect(() => {
    handleLayerChange(baseLayers[0])
  }, [])

  const handleSidebarClick = (buttonId, event) => {
    if (buttonId === 'mapType') {
      const button = event.currentTarget
      const rect = button.getBoundingClientRect()
      setButtonPosition({ top: rect.top })
      setShowLayerControl(!showLayerControl)
    }
  }

  const handleLayerChange = (layer) => {
    // Remove only base layers, keeping overlays
    map.eachLayer((mapLayer) => {
      if (mapLayer.options.attribution && !activeOverlays[mapLayer._url]) {
        map.removeLayer(mapLayer)
      }
    })

    // Add the selected base layer
    const { url, attribution, maxZoom } = layer
    L.tileLayer(url, {
      attribution,
      maxZoom,
      noWrap: false
    }).addTo(map)

    // Re-add all active overlays to ensure proper layer order
    Object.entries(activeOverlays).forEach(([name, isActive]) => {
      if (isActive) {
        const overlay = overlayLayers.find(ol => ol.name === name)
        if (overlay) {
          const { url, attribution, maxZoom, opacity, zIndex } = overlay
          L.tileLayer(url, {
            attribution,
            maxZoom,
            opacity,
            zIndex
          }).addTo(map)
        }
      }
    })

    setActiveLayer(layer.name)
  }

  const handleOverlayToggle = (overlay) => {
    setActiveOverlays(prev => {
      const newOverlays = { ...prev }
      
      if (newOverlays[overlay.name]) {
        // Remove overlay
        map.eachLayer((layer) => {
          if (layer._url === overlay.url) {
            map.removeLayer(layer)
          }
        })
        delete newOverlays[overlay.name]
      } else {
        // Add overlay
        const { url, attribution, maxZoom, opacity, zIndex } = overlay
        L.tileLayer(url, {
          attribution,
          maxZoom,
          opacity,
          zIndex
        }).addTo(map)
        newOverlays[overlay.name] = true
      }
      
      return newOverlays
    })
  }

  return (
    <>
      <div className={`sidebar ${theme}`}>
        {sidebarButtons.map((button) => (
          <button
            key={button.id}
            className={`sidebar-button ${theme} ${showLayerControl && button.id === 'mapType' ? 'active' : ''}`}
            onClick={(e) => handleSidebarClick(button.id, e)}
            title={button.label}
          >
            <span className="button-icon">{button.icon}</span>
          </button>
        ))}
      </div>

      {showLayerControl && (
        <div 
          className={`layer-control-panel ${theme}`} 
          style={{ top: buttonPosition.top }}
        >
          <div className="base-layers">
            <h4>Base Maps</h4>
            {baseLayers.map((layer) => (
              <label key={layer.name} className="layer-option">
                <input
                  type="radio"
                  name="baseLayer"
                  checked={activeLayer === layer.name}
                  onChange={() => handleLayerChange(layer)}
                />
                <span>{layer.name}</span>
              </label>
            ))}
          </div>

          <div className="overlay-layers">
            <h4>Overlays</h4>
            {overlayLayers.map((overlay) => (
              <label key={overlay.name} className="layer-option">
                <input
                  type="checkbox"
                  checked={!!activeOverlays[overlay.name]}
                  onChange={() => handleOverlayToggle(overlay)}
                />
                <span>{overlay.name}</span>
              </label>
            ))}
          </div>
        </div>
      )}
    </>
  )
}

export default Sidebar