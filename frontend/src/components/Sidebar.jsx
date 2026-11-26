/* eslint-disable react/prop-types -- internal component; the project does not use PropTypes */
import { useState, useEffect, useRef } from 'react'
import { usePhoneLayout } from '../hooks/usePhoneLayout'
import { attachSwipeToClose } from '../utils/swipeToClose'
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
  AiSparkIcon,
} from './Icons'
import { useMap } from 'react-leaflet'
import L from 'leaflet'
import { baseLayers, overlayLayers } from '../config/mapLayers'
import SettingsPanel from './SettingsPanel'
import AccountPanel from './AccountPanel'
import { MapObjectsPanel } from '../features/mapObjects'
import NotificationsPanel from './NotificationsPanel'
import TrackInfoPanel from './TrackInfoPanel'
import CopilotPanel from './CopilotPanel'
import { selectUnreadCount } from '../store/alertsSlice'
import { loadCopilotStatus } from '../store/copilotSlice'
import BrandMark from './BrandMark'
import './Sidebar.css'

// Rail buttons that open a panel, and those whose panel is tall (placed at the top, full height).
const PANELS = new Set(['copilot', 'mapType', 'objects', 'settings', 'notifications', 'trackInfo'])
const TALL_PANELS = new Set(['copilot', 'objects', 'notifications', 'trackInfo'])

// Phones: five labelled tabs; everything else is under "More".
const PHONE_TABS = [
  { id: 'copilot', Icon: AiSparkIcon, label: 'AI' },
  { id: 'trackInfo', Icon: ChartIcon, label: 'Ships' },
  { id: 'notifications', Icon: BellIcon, label: 'Alerts' },
  { id: 'objects', Icon: ShapesIcon, label: 'Zones' },
  { id: 'more', Icon: MenuIcon, label: 'More' },
]
const MORE_PANELS = new Set(['more', 'mapType', 'settings', 'account'])
// Names the shadow-cursor guide points at (data-guide), the same on desktop and phones.
const GUIDE_NAV = { copilot: 'nav.ai', trackInfo: 'nav.ships', notifications: 'nav.alerts', objects: 'nav.zones', more: 'nav.more', mapType: 'nav.layers', settings: 'nav.settings' }

const sidebarButtons = [
  { id: 'copilot', Icon: AiSparkIcon, label: 'AI copilot' },
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
  const phone = usePhoneLayout()

  // Whether the server has AI (shows or hides the ✦ buttons everywhere).
  useEffect(() => {
    dispatch(loadCopilotStatus())
  }, [dispatch])

  // Phones: panels are bottom sheets; drag one down by its top to close it.
  useEffect(() => {
    if (!phone || !rail) return
    return attachSwipeToClose(rail, { sheetSelector: '.layer-control-panel', onClose: () => setPanel(null) })
  }, [phone, rail])

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

  // The copilot can open the ship list with a search/zone filter (TrackInfoPanel applies it).
  const shipListRequest = useSelector((state) => state.copilot.shipListRequest)
  useEffect(() => {
    if (!shipListRequest) return
    if (collapsedRef.current) dispatch(toggleSidebar())
    setButtonPosition({ top: 12 })
    setPanel('trackInfo')
  }, [shipListRequest, dispatch])

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
  // Phones: bottom sheets placed by CSS; lists get a definite height so they scroll inside.
  const panelStyle = phone ? {} : { top: buttonPosition.top, maxHeight: `calc(100vh - ${buttonPosition.top + 12}px)` }
  // The ship list scrolls inside the panel, so it needs a definite height.
  const tallStyle = phone ? { height: '72vh' } : { ...panelStyle, height: panelStyle.maxHeight }
  const openPanel = (id) => setPanel((open) => (open === id ? null : id))
  const isActive = (id) => panel === id
  const showAccount = panel === 'account'

  const phoneNav = (
    <nav className={`sidebar phone-tabs ${theme}`} aria-label="Map tools">
      {PHONE_TABS.map(({ id, Icon, label }) => {
        const active = id === 'more' ? MORE_PANELS.has(panel) : panel === id
        const badge = id === 'notifications' && unread > 0 ? (unread > 99 ? '99+' : String(unread)) : null
        return (
          <button
            key={id}
            type="button"
            className={`tab-button ${id === 'copilot' ? 'ai' : ''} ${active ? 'active' : ''}`}
            data-guide={GUIDE_NAV[id]}
            onClick={() => openPanel(id === 'more' && MORE_PANELS.has(panel) ? panel : id)}
            aria-label={badge ? `${label} (${unread} new)` : label}
            aria-pressed={active}
          >
            <span className="tab-icon">
              <Icon />
              {badge && (
                <span className="sidebar-badge" aria-hidden="true">
                  {badge}
                </span>
              )}
            </span>
            <span className="tab-label">{label}</span>
          </button>
        )
      })}
    </nav>
  )

  return createPortal(
    <>
      {phone ? phoneNav : (
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
                className={`sidebar-button ${id === 'copilot' ? 'ai' : ''} ${isActive(id) ? 'active' : ''}`}
                data-guide={GUIDE_NAV[id]}
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
            data-guide="nav.cluster"
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
            data-guide="nav.account"
            onClick={() => setPanel((open) => (open === 'account' ? null : 'account'))}
            data-label={displayName(user)}
            aria-label="Account"
            aria-expanded={showAccount}
          >
            {initials(user)}
          </button>
        </div>
      </nav>
      )}

      {panel === 'more' && (
        <div className={`layer-control-panel more-panel ${theme}`} data-guide-panel="more">
          <div className="panel-header">
            <span>More</span>
            <button className="panel-close" onClick={closePanels} aria-label="Close">
              <CloseIcon size={16} />
            </button>
          </div>
          <button type="button" className="more-row" data-guide="more.layers" onClick={() => setPanel('mapType')}>
            <LayersIcon />
            <span>
              Map layers
              <small>{activeLayer}</small>
            </span>
          </button>
          <button type="button" className="more-row" data-guide="more.settings" onClick={() => setPanel('settings')}>
            <SettingsIcon />
            <span>
              Settings
              <small>Ship density, names, dark mode</small>
            </span>
          </button>
          <label className="more-row" data-guide="more.cluster">
            <ClusterIcon />
            <span>
              Group ships
              <small>Count bubbles when zoomed out</small>
            </span>
            <input type="checkbox" className="more-switch" checked={clustering} onChange={() => dispatch(toggleClustering())} />
          </label>
          {fullscreen?.supported && (
            <button type="button" className="more-row" onClick={fullscreen.toggle}>
              {fullscreen.isFullscreen ? <ExitFullscreenIcon /> : <FullscreenIcon />}
              <span>{fullscreen.isFullscreen ? 'Exit full screen' : 'Full screen'}</span>
            </button>
          )}
          <button type="button" className="more-row" data-guide="more.account" onClick={() => setPanel('account')}>
            <span className="more-avatar">{initials(user)}</span>
            <span>
              {displayName(user)}
              <small>Account and sign out</small>
            </span>
          </button>
        </div>
      )}

      {showAccount && <AccountPanel user={user} theme={theme} onClose={closePanels} />}

      {panel === 'settings' && <SettingsPanel style={panelStyle} onClose={closePanels} />}

      {panel === 'objects' && <MapObjectsPanel style={panelStyle} theme={theme} onClose={closePanels} />}

      {panel === 'notifications' && <NotificationsPanel style={panelStyle} theme={theme} onClose={closePanels} />}

      {panel === 'trackInfo' && <TrackInfoPanel style={tallStyle} theme={theme} onClose={closePanels} />}

      {panel === 'copilot' && <CopilotPanel style={tallStyle} theme={theme} onClose={closePanels} />}

      {panel === 'mapType' && (
        <div className={`layer-control-panel ${theme}`} style={panelStyle} data-guide-panel="layers">
          <div className="panel-header">
            <span>Map layers</span>
            <button className="panel-close" onClick={closePanels} aria-label="Close">
              <CloseIcon size={16} />
            </button>
          </div>
          <div className="base-layers" data-guide="layers.base">
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

          <div className="overlay-layers" data-guide="layers.overlays">
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