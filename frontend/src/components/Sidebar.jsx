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
import NotificationsPanel from './NotificationsPanel'
import TrackInfoPanel from './TrackInfoPanel'
import { selectUnreadCount } from '../store/alertsSlice'
import BrandMark from './BrandMark'
import './Sidebar.css'

// Rail buttons that open a panel, and those whose panel is tall (placed at the top, full height).
const PANELS = new Set(['mapType', 'objects', 'settings', 'notifications', 'trackInfo'])
const TALL_PANELS = new Set(['objects', 'notifications', 'trackInfo'])

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
  // The open panel (one at a time): a rail button id ('mapType', 'objects', ...), 'account' or null.
  const [panel, setPanel] = useState(null)
  const unread = useSelector(selectUnreadCount)
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
    setPanel((open) => {
      if (open !== 'objects') setButtonPosition({ top: 12 })
      return 'objects'
    })
  }, [selection, objectCommand, dispatch])

  const handleSidebarClick = (buttonId, event) => {
    const rect = event.currentTarget.getBoundingClientRect()
    // Align the panel with its button, but keep at least ~320px of it on screen.
    const top = Math.max(12, Math.min(rect.top - 6, window.innerHeight - 332))
    if (!PANELS.has(buttonId)) return // no panel yet (Routes)
    // Tall panels (lists) use the full height; small ones line up with their button.
    setButtonPosition({ top: TALL_PANELS.has(buttonId) ? 12 : top })
    setPanel((open) => (open === buttonId ? null : buttonId))
  }

  const handleLayerChange = (layer) => dispatch(setBaseLayer(layer.name))
  const handleOverlayToggle = (overlay) => dispatch(toggleOverlay(overlay.name))

  if (!rail) return null
  const closePanels = () => setPanel(null)
  const panelStyle = { top: buttonPosition.top, maxHeight: `calc(100vh - ${buttonPosition.top + 12}px)` }
  // The ship list scrolls inside the panel, so it needs a definite height.
  const tallStyle = { ...panelStyle, height: panelStyle.maxHeight }
  const isActive = (id) => panel === id
  const showAccount = panel === 'account'

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
          {sidebarButtons.map(({ id, Icon, label }) => {
            const badge = id === 'notifications' && unread > 0 ? (unread > 99 ? '99+' : String(unread)) : null
            const fullLabel = badge ? `${label} (${unread} new)` : label
            return (
              <button
                key={id}
                className={`sidebar-button ${isActive(id) ? 'active' : ''}`}
                onClick={(e) => handleSidebarClick(id, e)}
                data-label={fullLabel}
                aria-label={fullLabel}
                aria-pressed={isActive(id)}
              >
                <Icon />
                {badge && (
                  <span className="sidebar-badge" aria-hidden="true">
                    {badge}
                  </span>
                )}
              </button>
            )
          })}
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
            onClick={() => setPanel((open) => (open === 'account' ? null : 'account'))}
            data-label={displayName(user)}
            aria-label="Account"
            aria-expanded={showAccount}
          >
            {initials(user)}
          </button>
        </div>
      </nav>

      {showAccount && <AccountPanel user={user} theme={theme} onClose={closePanels} />}

      {panel === 'settings' && <SettingsPanel style={panelStyle} onClose={closePanels} />}

      {panel === 'objects' && <MapObjectsPanel style={panelStyle} theme={theme} onClose={closePanels} />}

      {panel === 'notifications' && <NotificationsPanel style={panelStyle} theme={theme} onClose={closePanels} />}

      {panel === 'trackInfo' && <TrackInfoPanel style={tallStyle} theme={theme} onClose={closePanels} />}

      {panel === 'mapType' && (
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