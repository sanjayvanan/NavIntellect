import { useCallback, useEffect, useState } from 'react'

/** Browser fullscreen for the whole app (Esc also exits). */
export function useFullscreen() {
  const [isFullscreen, setIsFullscreen] = useState(() => !!document.fullscreenElement)

  useEffect(() => {
    const onChange = () => setIsFullscreen(!!document.fullscreenElement)
    document.addEventListener('fullscreenchange', onChange)
    return () => document.removeEventListener('fullscreenchange', onChange)
  }, [])

  const toggle = useCallback(() => {
    if (document.fullscreenElement) document.exitFullscreen?.()
    else document.documentElement.requestFullscreen?.().catch(() => {})
  }, [])

  return { isFullscreen, toggle, supported: !!document.documentElement.requestFullscreen }
}
