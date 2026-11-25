/* eslint-disable react/prop-types -- internal component; the project does not use PropTypes */
import { useState, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { useSelector, useDispatch } from 'react-redux'
import { toggleClustering, toggleSidebar } from '../store/themeSlice'
import {
  BellIcon,
  ChartIcon,
  CloseIcon,
  ClusterIcon,
  ExitFullscreenIcon,
  FullscreenIcon,
  LayersIcon,
  MenuIcon,
  RouteIcon,
  SettingsIcon,
  ShapesIcon,
} from './Icons'
import { useMap } from 'react-leaflet'
import L from 'leaflet'
import { baseLayers, overlayLayers } from '../config/mapLayers'
import SettingsPanel from './SettingsPanel'
import './Sidebar.css'

const sidebarButtons = [
  { id: 'mapType', Icon: LayersIcon, label: 'Map layers' },
  { id: 'objects', Icon: ShapesIcon, label: 'Graphical objects' },
  { id: 'settings', Icon: SettingsIcon, label: 'Settings' },
  { id: 'routes', Icon: RouteIcon, label: 'Routes' },
  { id: 'notifications', Icon: BellIcon, label: 'Notifications' },
  { id: 'trackInfo', Icon: ChartIcon, label: 'Track info' },
]

/**
 * Left rail. It is a React child of the map (it needs useMap for base layers) but its DOM is
 * portalled into `rail`, an element beside the map, so clicks on it can never reach the map
 * or the ships drawn underneath.
 */
function Sidebar({ rail, fullscreen }) {
  const dispatch = useDispatch()
  const theme = useSelector((state) => state.theme.mode)
  const clustering = useSelector((state) => state.theme.clustering)
  const [showLayerControl, setShowLayerControl] = useState(false)
  const [showSettings, setShowSettings] = useState(false)
  const [activeLayer, setActiveLayer] = useState(baseLayers[0].name)
  const [activeOverlays, setActiveOverlays] = useState({})
  const [buttonPosition, setButtonPosition] = useState({ top: 0 })
  const map = useMap()

  // Initialize first base layer on mount
  useEffect(() => {
    handleLayerChange(baseLayers[0])
  }, [])

  const handleSidebarClick = (buttonId, event) => {
    const rect = event.currentTarget.getBoundingClientRect()
    // Align the panel with its button, but keep at least ~320px of it on screen.
    const top = Math.max(12, Math.min(rect.top - 6, window.innerHeight - 332))
    if (buttonId === 'mapType') {
      setButtonPosition({ top })
      setShowLayerControl(!showLayerControl)
      setShowSettings(false)
    } else if (buttonId === 'settings') {
      setButtonPosition({ top })
      setShowSettings(!showSettings)
      setShowLayerControl(false)
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

  if (!rail) return null
  const closePanels = () => {
    setShowLayerControl(false)
    setShowSettings(false)
  }
  const panelStyle = { top: buttonPosition.top, maxHeight: `calc(100vh - ${buttonPosition.top + 12}px)` }
  const isActive = (id) => (id === 'mapType' && showLayerControl) || (id === 'settings' && showSettings)

  return createPortal(
    <>
      <nav className={`sidebar ${theme}`} aria-label="Map tools">
        {/* Same icon and position as the floating "show sidebar" button, so the toggle never moves. */}
        <button
          className="sidebar-button sidebar-toggle"
          onClick={() => {
            closePanels()
            dispatch(toggleSidebar())
          }}
          data-label="Hide sidebar"
          aria-label="Hide sidebar"
        >
          <MenuIcon />
        </button>
        <div className="sidebar-divider" />

        <div className="sidebar-group">
          {sidebarButtons.map(({ id, Icon, label }) => (
            <button
              key={id}
              className={`sidebar-button ${isActive(id) ? 'active' : ''}`}
              onClick={(e) => handleSidebarClick(id, e)}
              data-label={label}
              aria-label={label}
              aria-pressed={isActive(id)}
            >
              <Icon />
            </button>
          ))}
        </div>

        <div className="sidebar-spacer" />

        <div className="sidebar-group">
          <button
            className={`sidebar-button ${clustering ? 'on' : ''}`}
            onClick={() => dispatch(toggleClustering())}
            data-label={clustering ? 'Clustering: on' : 'Clustering: off'}
            aria-label="Cluster ships"
            aria-pressed={clustering}
          >
            <ClusterIcon />
          </button>
          {fullscreen?.supported && (
            <button
              className={`sidebar-button ${fullscreen.isFullscreen ? 'on' : ''}`}
              onClick={fullscreen.toggle}
              data-label={fullscreen.isFullscreen ? 'Exit full screen' : 'Full screen'}
              aria-label="Full screen"
              aria-pressed={fullscreen.isFullscreen}
            >
              {fullscreen.isFullscreen ? <ExitFullscreenIcon /> : <FullscreenIcon />}
            </button>
          )}
        </div>
      </nav>

      {showSettings && <SettingsPanel style={panelStyle} onClose={closePanels} />}

      {showLayerControl && (
        <div className={`layer-control-panel ${theme}`} style={panelStyle}>
          <div className="panel-header">
            <span>Map layers</span>
            <button className="panel-close" onClick={closePanels} aria-label="Close">
              <CloseIcon size={16} />
            </button>
          </div>
          <div className="base-layers">
            <h4>Base map</h4>
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
    </>,
    rail,
  )
}

export default Sidebar