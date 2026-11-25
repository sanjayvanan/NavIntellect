import L from 'leaflet'

/**
 * Shared "tool mode" for interactive map tools (drawing, pin dropping, …):
 *  - crosshair cursor (CSS class `map-drawing` on the map container)
 *  - double-click zoom off (double-click finishes shapes)
 *  - `map._drawingActive` set, so ShipCanvasLayer / ZonesLayer / pins ignore clicks meanwhile
 *  - keyboard shortcuts routed to the tool, except while typing in a form field
 * Returns a function that leaves tool mode again.
 */

/** True when a key event comes from a text field (shortcuts must not fire there). */
export const isTypingTarget = (t) =>
  !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)

// Leaflet fires a click right after a finishing double-click; clicks stay blocked this long after exit.
const CLICK_GRACE_MS = 350

export function enterToolMode(map, { onKey } = {}) {
  map._toolModeDepth = (map._toolModeDepth || 0) + 1
  map._drawingActive = true
  const restoreDblZoom = map.doubleClickZoom.enabled()
  map.doubleClickZoom.disable()
  L.DomUtil.addClass(map.getContainer(), 'map-drawing')

  const keyHandler = (e) => {
    if (isTypingTarget(e.target)) return
    onKey?.(e)
  }
  if (onKey) document.addEventListener('keydown', keyHandler, true)

  let exited = false
  return function exitToolMode() {
    if (exited) return
    exited = true
    if (onKey) document.removeEventListener('keydown', keyHandler, true)
    if (restoreDblZoom) map.doubleClickZoom.enable()
    map._toolModeDepth -= 1
    if (map._toolModeDepth === 0) {
      L.DomUtil.removeClass(map.getContainer(), 'map-drawing')
      setTimeout(() => {
        if (!map._toolModeDepth) map._drawingActive = false
      }, CLICK_GRACE_MS)
    }
  }
}
