import L from 'leaflet'
import { formatLatLng } from '../../../utils/coords'
import { pinMarkerIcon } from '../pins/pinStyle'
import { enterToolMode } from './interaction'

/**
 * Click-to-place a pin. A ghost pin follows the cursor with its coordinates; a click places it
 * (onPlace(latlng)), Esc cancels (onCancel()). The map stays pannable meanwhile.
 */
export class PinDropTool {
  constructor(map, { onPlace, onCancel } = {}) {
    this.map = map
    this.cb = { onPlace, onCancel }
    this.active = false
  }

  start(style = {}) {
    this.stop()
    this.active = true
    const map = this.map
    this._ghost = L.marker(map.getCenter(), {
      icon: pinMarkerIcon({ ...style, ghost: true }),
      interactive: false,
      keyboard: false,
      opacity: 0,
    }).addTo(map)
    this._ghost.bindTooltip('', { permanent: true, direction: 'right', offset: [14, -18], className: 'draw-cursor-tip' })
    this._exit = enterToolMode(map, {
      onKey: (e) => {
        if (e.key === 'Escape') {
          e.preventDefault()
          this.cancel()
        }
      },
    })
    map.on('mousemove', this._onMove, this)
    map.on('click', this._onClick, this)
  }

  stop() {
    if (!this.active) return
    this.active = false
    this.map.off('mousemove', this._onMove, this)
    this.map.off('click', this._onClick, this)
    this._exit?.()
    this._ghost?.remove()
    this._ghost = null
  }

  cancel() {
    if (!this.active) return
    this.stop()
    this.cb.onCancel?.()
  }

  destroy() {
    this.stop()
  }

  _onMove(e) {
    this._ghost.setLatLng(e.latlng).setOpacity(0.85)
    this._ghost.setTooltipContent(`Click to drop pin<br><b>${formatLatLng(this.map.wrapLatLng(e.latlng))}</b>`)
  }

  _onClick(e) {
    const { lat, lng } = this.map.wrapLatLng(e.latlng)
    this.stop()
    this.cb.onPlace?.({ lat, lng }) // plain object: it ends up in Redux actions
  }
}
