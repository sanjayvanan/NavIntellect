const CLOSE_DISTANCE = 80 // px dragged down that closes the sheet
const GRAB_ZONE = 44 // px from a sheet's top edge that start a drag (its handle and header)

/**
 * Bottom sheets: drag a sheet down by its top (handle / header) to close it, like native apps.
 * Listens on `container` for any sheet inside it matching `sheetSelector`; the content below
 * the grab zone keeps scrolling normally. Returns a cleanup function.
 */
export function attachSwipeToClose(container, { sheetSelector, onClose }) {
  let drag = null

  const onStart = (e) => {
    if (e.touches.length !== 1) return
    const sheet = e.target.closest?.(sheetSelector)
    if (!sheet || !container.contains(sheet)) return
    if (e.target.closest('button, a, input, textarea, select, label')) return
    const y = e.touches[0].clientY
    if (y - sheet.getBoundingClientRect().top > GRAB_ZONE) return
    drag = { sheet, startY: y, dy: 0, t: Date.now() }
    sheet.style.transition = 'none'
  }

  const onMove = (e) => {
    if (!drag) return
    drag.dy = Math.max(0, e.touches[0].clientY - drag.startY)
    drag.sheet.style.transform = `translateY(${drag.dy}px)`
    if (e.cancelable) e.preventDefault() // the page must not scroll or zoom meanwhile
  }

  const onEnd = () => {
    if (!drag) return
    const { sheet, dy, t } = drag
    drag = null
    const fast = dy > 30 && dy / Math.max(1, Date.now() - t) > 0.5 // a quick flick also closes
    sheet.style.transition = 'transform 0.2s ease'
    if (dy > CLOSE_DISTANCE || fast) {
      sheet.style.transform = 'translateY(100%)'
      setTimeout(() => onClose(sheet), 180)
    } else {
      sheet.style.transform = ''
    }
  }

  container.addEventListener('touchstart', onStart, { passive: true })
  container.addEventListener('touchmove', onMove, { passive: false })
  container.addEventListener('touchend', onEnd)
  container.addEventListener('touchcancel', onEnd)
  return () => {
    container.removeEventListener('touchstart', onStart)
    container.removeEventListener('touchmove', onMove)
    container.removeEventListener('touchend', onEnd)
    container.removeEventListener('touchcancel', onEnd)
  }
}
