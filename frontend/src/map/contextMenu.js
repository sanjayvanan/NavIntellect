import L from 'leaflet'
import { formatLatLng } from '../utils/coords'

/**
 * Right-click menu for the map. Items come from `getItems()` each time it opens, so features can
 * contribute entries without knowing about each other:
 *   { id, label, icon?: svg markup, onSelect(latlng), hidden?(latlng) => boolean }
 * Closes on selection, Esc, a click elsewhere, or any map movement.
 */
export class MapContextMenu {
  constructor(map, getItems) {
    this.map = map
    this.getItems = getItems
    this.el = null
    map.on('contextmenu', this._open, this)
  }

  destroy() {
    this.close()
    this.map.off('contextmenu', this._open, this)
  }

  close() {
    if (!this.el) return
    this.el.remove()
    this.el = null
    this.map.off('movestart zoomstart click', this.close, this)
    document.removeEventListener('keydown', this._onKey, true)
    document.removeEventListener('pointerdown', this._onOutside, true)
  }

  _open(e) {
    L.DomEvent.preventDefault(e.originalEvent)
    this.close()
    if (this.map._drawingActive) return // right-click while drawing does nothing
    const latlng = this.map.wrapLatLng(e.latlng)
    const items = this.getItems().filter((it) => !it.hidden?.(latlng))
    if (!items.length) return

    const el = L.DomUtil.create('div', 'map-context-menu', this.map.getContainer())
    el.setAttribute('role', 'menu')
    const head = L.DomUtil.create('div', 'map-context-menu-head', el)
    head.innerHTML = formatLatLng(latlng)
    for (const item of items) {
      const btn = L.DomUtil.create('button', 'map-context-menu-item', el)
      btn.type = 'button'
      btn.setAttribute('role', 'menuitem')
      btn.innerHTML = `${item.icon || ''}<span></span>`
      btn.lastChild.textContent = item.label
      L.DomEvent.on(btn, 'click', (ev) => {
        L.DomEvent.stop(ev)
        this.close()
        item.onSelect(latlng)
      })
    }
    L.DomEvent.disableClickPropagation(el)
    L.DomEvent.disableScrollPropagation(el)
    L.DomEvent.on(el, 'contextmenu', L.DomEvent.stop)

    // Place at the pointer, kept inside the map.
    const size = this.map.getSize()
    const { x, y } = e.containerPoint
    const w = el.offsetWidth
    const h = el.offsetHeight
    el.style.left = `${Math.min(x, size.x - w - 8)}px`
    el.style.top = `${Math.min(y, size.y - h - 8)}px`
    this.el = el
    el.querySelector('button')?.focus({ preventScroll: true })

    this._onKey = (ev) => {
      if (ev.key === 'Escape') this.close()
    }
    this._onOutside = (ev) => {
      if (this.el && !this.el.contains(ev.target)) this.close()
    }
    this.map.on('movestart zoomstart click', this.close, this)
    document.addEventListener('keydown', this._onKey, true)
    document.addEventListener('pointerdown', this._onOutside, true)
  }
}
