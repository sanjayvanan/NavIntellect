import { useState } from 'react'
import { useDispatch, useSelector } from 'react-redux'
import MapComponent from './components/MapComponent'
import Sidebar from './components/Sidebar'
import { ExitFullscreenIcon, FullscreenIcon, MenuIcon } from './components/Icons'
import { useFullscreen } from './hooks/useFullscreen'
import { toggleSidebar } from './store/themeSlice'
import './App.css'

function App() {
  const dispatch = useDispatch()
  const theme = useSelector((state) => state.theme.mode)
  const collapsed = useSelector((state) => state.theme.sidebarCollapsed)
  const fullscreen = useFullscreen()
  // The sidebar rail sits beside the map (not on top of it); Sidebar portals into it.
  const [rail, setRail] = useState(null)

  return (
    <div className={`app ${theme} ${collapsed ? 'sidebar-collapsed' : ''}`}>
      <aside ref={setRail} className={`sidebar-rail ${theme}`} aria-hidden={collapsed} />

      {/* Collapsed: the rail shrinks to this small floating group over the map. */}
      {collapsed && (
        <div className={`floating-controls ${theme}`}>
          <button className="chrome-button" onClick={() => dispatch(toggleSidebar())} title="Show sidebar">
            <MenuIcon />
          </button>
          {fullscreen.supported && (
            <button
              className="chrome-button"
              onClick={fullscreen.toggle}
              title={fullscreen.isFullscreen ? 'Exit full screen (Esc)' : 'Full screen'}
            >
              {fullscreen.isFullscreen ? <ExitFullscreenIcon /> : <FullscreenIcon />}
            </button>
          )}
        </div>
      )}

      <main className="map-area">
        <MapComponent>
          <Sidebar rail={rail} fullscreen={fullscreen} />
        </MapComponent>
      </main>
    </div>
  )
}

export default App
