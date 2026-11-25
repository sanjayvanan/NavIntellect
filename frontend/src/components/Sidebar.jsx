/* eslint-disable react/prop-types -- internal component; the project does not use PropTypes */
import { useState, useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { useSelector, useDispatch } from 'react-redux'
import { setBaseLayer, toggleClustering, toggleOverlay, toggleSidebar } from '../store/themeSlice'
import { initials, displayName } from '../utils/user'
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
import AccountPanel from './AccountPanel'
import { MapObjectsPanel } from '../features/mapObjects'
import BrandMark from './BrandMark'
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
  const activeLayer = useSelector((state) => state.theme.baseLayer)
  const activeOverlays = useSelector((state) => state.theme.overlays)
  const user = useSelector((state) => state.auth.user)
  const [showLayerControl, setShowLayerControl] = useState(false)
  const [showSettings, setShowSettings] = useState(false)
  const [showAccount, setShowAccount] = useState(false)
  const [showObjects, setShowObjects] = useState(false)
  const selection = useSelector((state) => state.mapObjectsUi.selection)
  const objectCommand = useSelector((state) => state.mapObjectsUi.command)
  const [buttonPosition, setButtonPosition] = useState({ top: 0 })
  const map = useMap()

  // Base map: one tile layer, swapped when the (saved) choice changes. Restored on sign-in.
  useEffect(() => {
    const layer = baseLayers.find((l) => l.name === activeLayer) ?? baseLayers[0]
    const tiles = L.tileLayer(layer.url, { attribution: layer.attribution, maxZoom: layer.maxZoom, noWrap: false, zIndex: 1 })
    tiles.addTo(map)
    return () => {
      map.removeLayer(tiles)
    }
  }, [map, activeLayer])

  // Overlays drawn above the base map, one tile layer each.
  const overlayKey = activeOverlays.join('|')
  useEffect(() => {
    const tiles = overlayLayers
      .filter((o) => activeOverlays.includes(o.name))
      .map(({ url, attribution, maxZoom, opacity, zIndex }) => L.tileLayer(url, { attribution, maxZoom, opacity, zIndex }).addTo(map))
    return () => tiles.forEach((t) => map.removeLayer(t))
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed by overlayKey
  }, [map, overlayKey])

  // Selecting a zone/pin on the map, or a map context-menu command (drop pin, measure from here),
  // opens the objects panel, which then shows the details / carries out the command. The panel
  // lives in the rail, so a collapsed sidebar is expanded first (otherwise it would open hidden).
  const collapsed = useSelector((state) => state.theme.sidebarCollapsed)
  const collapsedRef = useRef(collapsed)
  collapsedRef.current = collapsed
  useEffect(() => {
    if (!selection && !objectCommand) return
    if (collapsedRef.current) dispatch(toggleSidebar())
    setShowObjects((open) => {
      if (!open) setButtonPosition({ top: 12 })
      return true
    })
    setShowLayerControl(false)
    setShowSettings(false)
    setShowAccount(false)
  }, [selection, objectCommand, dispatch])

  const handleSidebarClick = (buttonId, event) => {
    const rect = event.currentTarget.getBoundingClientRect()
    // Align the panel with its button, but keep at least ~320px of it on screen.
    const top = Math.max(12, Math.min(rect.top - 6, window.innerHeight - 332))
    setShowAccount(false)
    if (buttonId === 'mapType') {
      setButtonPosition({ top })
      setShowLayerControl(!showLayerControl)
      setShowSettings(false)
      setShowObjects(false)
    } else if (buttonId === 'settings') {
      setButtonPosition({ top })
      setShowSettings(!showSettings)
      setShowLayerControl(false)
      setShowObjects(false)
    } else if (buttonId === 'objects') {
      setButtonPosition({ top: 12 }) // tall panel: use the full height
      setShowObjects(!showObjects)
      setShowLayerControl(false)
      setShowSettings(false)
    }
  }

  const handleLayerChange = (layer) => dispatch(setBaseLayer(layer.name))
  const handleOverlayToggle = (overlay) => dispatch(toggleOverlay(overlay.name))

  if (!rail) return null
  const closePanels = () => {
    setShowLayerControl(false)
    setShowSettings(false)
    setShowAccount(false)
    setShowObjects(false)
  }
  const panelStyle = { top: buttonPosition.top, maxHeight: `calc(100vh - ${buttonPosition.top + 12}px)` }
  const isActive = (id) =>
    (id === 'mapType' && showLayerControl) || (id === 'settings' && showSettings) || (id === 'objects' && showObjects)

  return createPortal(
    <>
      <nav className={`sidebar ${theme}`} aria-label="Map tools">
        <BrandMark theme={theme} />
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
          <div className="sidebar-divider" />
          <button
            className={`sidebar-avatar ${showAccount ? 'active' : ''}`}
            onClick={() => {
              setShowLayerControl(false)
              setShowSettings(false)
              setShowObjects(false)
              setShowAccount(!showAccount)
            }}
            data-label={displayName(user)}
            aria-label="Account"
            aria-expanded={showAccount}
          >
            {initials(user)}
          </button>
        </div>
      </nav>

      {showAccount && <AccountPanel user={user} theme={theme} onClose={closePanels} />}

      {showSettings && <SettingsPanel style={panelStyle} onClose={closePanels} />}

      {showObjects && <MapObjectsPanel style={panelStyle} theme={theme} onClose={closePanels} />}

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
                  checked={activeOverlays.includes(overlay.name)}
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