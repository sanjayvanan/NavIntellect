import ShadowGuide from './components/ShadowGuide'
import { useEffect, useState } from 'react'
import { useDispatch, useSelector } from 'react-redux'
import MapComponent from './components/MapComponent'
import Sidebar from './components/Sidebar'
import AuthScreen from './components/AuthScreen'
import Landing from './landing/Landing'
import { navigate, usePath } from './hooks/usePath'
import BrandMark from './components/BrandMark'
import { ExitFullscreenIcon, FullscreenIcon, MenuIcon } from './components/Icons'
import { useFullscreen } from './hooks/useFullscreen'
import { toggleSidebar } from './store/themeSlice'
import emblem from './assets/navintellect-emblem.svg'
import './App.css'
import './components/AuthScreen.css'

function Splash() {
  return (
    <div className="auth-splash" role="status">
      <div className="auth-splash-content">
        <div className="auth-splash-badge">
          <img src={emblem} alt="" />
        </div>
        <p>Restoring your workspace</p>
      </div>
    </div>
  )
}

function Workspace() {
  const dispatch = useDispatch()
  const theme = useSelector((state) => state.theme.mode)
  const collapsed = useSelector((state) => state.theme.sidebarCollapsed)
  const fullscreen = useFullscreen()
  // The sidebar rail sits beside the map (not on top of it); Sidebar portals into it.
  const [rail, setRail] = useState(null)

  return (
    <div className={`app ${theme} ${collapsed ? 'sidebar-collapsed' : ''}`}>
      <aside ref={setRail} className={`sidebar-rail ${theme}`} aria-hidden={collapsed} />
      <ShadowGuide />

      {/* Collapsed: the rail shrinks to this small floating group over the map, at the same spots. */}
      {collapsed && (
        <div className={`floating-controls ${theme}`}>
          <BrandMark theme={theme} />
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

const AUTH_PATHS = { '/login': 'signin', '/signup': 'register' }

/**
 * Signed out: the landing page at '/', the sign-in page at '/login' and '/signup'.
 * Signed in: the map, at '/'.
 */
function App() {
  const status = useSelector((state) => state.auth.status)
  const path = usePath()
  const signedIn = status === 'signedIn'

  // After signing in from /login or /signup, the address goes back to '/'.
  useEffect(() => {
    if (signedIn && AUTH_PATHS[path]) navigate('/', { replace: true })
  }, [signedIn, path])

  if (status === 'checking') return <Splash />
  if (signedIn) return <Workspace />
  const mode = AUTH_PATHS[path]
  if (mode) {
    return (
      <AuthScreen
        mode={mode}
        onModeChange={(m) => navigate(m === 'register' ? '/signup' : '/login', { replace: true })}
        onBack={() => navigate('/')}
      />
    )
  }
  return <Landing />
}

export default App
