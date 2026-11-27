import { useEffect, useState } from 'react'

/**
 * Minimal routing for the signed-out pages: '/' (landing), '/login', '/signup'.
 * The signed-in app lives on '/' too, so a full router is not needed.
 */
const EVENT = 'css:navigate'

export function navigate(path, { replace = false } = {}) {
  if (window.location.pathname === path) return
  window.history[replace ? 'replaceState' : 'pushState'](null, '', path)
  window.dispatchEvent(new Event(EVENT))
}

export function usePath() {
  const [path, setPath] = useState(() => window.location.pathname)
  useEffect(() => {
    const update = () => setPath(window.location.pathname)
    window.addEventListener('popstate', update)
    window.addEventListener(EVENT, update)
    return () => {
      window.removeEventListener('popstate', update)
      window.removeEventListener(EVENT, update)
    }
  }, [])
  return path
}
