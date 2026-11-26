import { useSyncExternalStore } from 'react'

/** Phone layout: the sidebar becomes a bottom tab bar and panels become bottom sheets. */
const QUERY = '(max-width: 768px)'

export const isPhoneLayout = () => window.matchMedia?.(QUERY).matches ?? false

const subscribe = (onChange) => {
  const media = window.matchMedia?.(QUERY)
  if (!media) return () => {}
  media.addEventListener?.('change', onChange)
  return () => media.removeEventListener?.('change', onChange)
}

/** True while the screen is phone-sized; re-renders when that changes (rotation, resizing). */
export const usePhoneLayout = () => useSyncExternalStore(subscribe, isPhoneLayout, () => false)
