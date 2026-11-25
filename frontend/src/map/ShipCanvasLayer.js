import L from 'leaflet'
import { shipCategories } from '../config/shipCategories'

// The ship arrow from assets/ShipIcon.svg (viewBox 38x33, nose pointing east), centred.
const ARROW = [[37, 16.6], [1.2, 1.7], [8.1, 16.6], [1.2, 31.6]].map(([x, y]) => [x - 19, y - 16.6])
const SELECTED_COLOR = '#f44336'
const HIT_RADIUS_PX = 10

const colorOf = (ship) => (shipCategories[ship.message_type__id] || shipCategories.default).color

/** Arrow length in px for a zoom level: small when zoomed out, bigger close in. */
const arrowSize = (zoom) => (zoom < 4 ? 8 : zoom < 8 ? 10 : 13)

/**
 * Draws all ships on one <canvas> instead of one DOM marker per ship, so thousands of ships pan
 * and update at 60 fps. Handles hit-testing itself: click -> onSelect(ship) / onEmptyClick(),
 * hover -> pointer cursor + name tooltip.
 */
export const ShipCanvasLayer = L.Layer.extend({
  initialize(options) {
    L.setOptions(this, options)
    this._ships = []
    this._selected = null
    this._hits = [] // [x, y, ship] of everything drawn in the last frame
    this._raf = null
  },

  onAdd(map) {
    if (!map.getPane('ships')) {
      const pane = map.createPane('ships')
      pane.style.zIndex = 450 // above tiles/overlays, below popups
      pane.style.pointerEvents = 'none'
    }
    // leaflet-zoom-hide: Leaflet hides it during the zoom animation; redrawn on zoomend.
    this._canvas = L.DomUtil.create('canvas', 'ship-canvas leaflet-zoom-hide', map.getPane('ships'))
    this._ctx = this._canvas.getContext('2d')
    this._tooltip = L.tooltip({ direction: 'top', offset: [0, -8], className: 'ship-hover-tooltip' })
    map.on('move zoomend resize viewreset', this._schedule, this)
    map.on('click', this._onClick, this)
    map.on('mousemove', this._onMouseMove, this)
    map.on('mouseout', this._clearHover, this)
    this._schedule()
  },

  onRemove(map) {
    map.off('move zoomend resize viewreset', this._schedule, this)
    map.off('click', this._onClick, this)
    map.off('mousemove', this._onMouseMove, this)
    map.off('mouseout', this._clearHover, this)
    this._clearHover()
    if (this._raf) cancelAnimationFrame(this._raf)
    L.DomUtil.remove(this._canvas)
  },

  /** ships: legacy rows; selected: the selected ship (drawn on top, even if not in `ships`). */
  setData(ships, selected) {
    this._ships = ships || []
    this._selected = selected || null
    this._schedule()
  },

  _schedule() {
    if (this._raf || !this._map) return
    this._raf = requestAnimationFrame(() => {
      this._raf = null
      this._draw()
    })
  },

  _draw() {
    const map = this._map
    const size = map.getSize()
    const dpr = window.devicePixelRatio || 1
    const canvas = this._canvas
    if (canvas.width !== size.x * dpr || canvas.height !== size.y * dpr) {
      canvas.width = size.x * dpr
      canvas.height = size.y * dpr
      canvas.style.width = `${size.x}px`
      canvas.style.height = `${size.y}px`
    }
    // Keep the canvas glued to the viewport while the map pane is dragged.
    L.DomUtil.setPosition(canvas, map.containerPointToLayerPoint([0, 0]))

    const ctx = this._ctx
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.clearRect(0, 0, canvas.width, canvas.height)

    const len = arrowSize(map.getZoom())
    const selectedMmsi = this._selected?.mmsi
    const hits = []
    const margin = 20
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.45)'

    for (const ship of this._ships) {
      if (ship.mmsi === selectedMmsi || ship.latitude == null) continue
      const p = map.latLngToContainerPoint([ship.latitude, ship.longitude])
      if (p.x < -margin || p.y < -margin || p.x > size.x + margin || p.y > size.y + margin) continue
      this._arrow(ctx, dpr, p.x, p.y, ship.course_over_ground || 0, len, colorOf(ship))
      hits.push([p.x, p.y, ship])
    }

    if (this._selected?.latitude != null) {
      const s = this._selected
      const p = map.latLngToContainerPoint([s.latitude, s.longitude])
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      ctx.beginPath()
      ctx.arc(p.x, p.y, len * 1.3, 0, Math.PI * 2)
      ctx.fillStyle = 'rgba(244, 67, 54, 0.18)'
      ctx.fill()
      ctx.lineWidth = 1.5
      ctx.strokeStyle = SELECTED_COLOR
      ctx.stroke()
      ctx.strokeStyle = 'rgba(0, 0, 0, 0.45)'
      this._arrow(ctx, dpr, p.x, p.y, s.course_over_ground || 0, len * 1.5, SELECTED_COLOR)
      hits.push([p.x, p.y, s])
    }
    this._hits = hits
  },

  _arrow(ctx, dpr, x, y, courseDeg, len, color) {
    const a = ((courseDeg - 90) * Math.PI) / 180 // nose points east at 90°, like the old icon
    const s = len / 36
    const cos = Math.cos(a) * s * dpr
    const sin = Math.sin(a) * s * dpr
    ctx.setTransform(cos, sin, -sin, cos, x * dpr, y * dpr)
    ctx.beginPath()
    ctx.moveTo(ARROW[0][0], ARROW[0][1])
    for (let i = 1; i < ARROW.length; i++) ctx.lineTo(ARROW[i][0], ARROW[i][1])
    ctx.closePath()
    ctx.fillStyle = color
    ctx.fill()
    ctx.lineWidth = 21.6 / len // ~0.6 px outline: line width is in the arrow's scaled units
    ctx.stroke()
  },

  /** Nearest drawn ship within HIT_RADIUS_PX of a container point. */
  _hitTest(point) {
    let best = null
    let bestD = HIT_RADIUS_PX * HIT_RADIUS_PX
    for (const [x, y, ship] of this._hits) {
      const d = (x - point.x) ** 2 + (y - point.y) ** 2
      if (d <= bestD) {
        bestD = d
        best = ship
      }
    }
    return best
  },

  _onClick(e) {
    const ship = this._hitTest(e.containerPoint)
    if (ship) this.options.onSelect?.(ship)
    else this.options.onEmptyClick?.()
  },

  _onMouseMove(e) {
    const ship = this._hitTest(e.containerPoint)
    const container = this._map.getContainer()
    if (!ship) {
      this._clearHover()
      return
    }
    container.style.cursor = 'pointer'
    if (this._hoverMmsi !== ship.mmsi) {
      this._hoverMmsi = ship.mmsi
      this._tooltip.setLatLng([ship.latitude, ship.longitude]).setContent(ship.track_name || `MMSI ${ship.mmsi}`)
      this._map.openTooltip(this._tooltip)
    }
  },

  _clearHover() {
    if (!this._map) return
    this._map.getContainer().style.cursor = ''
    if (this._hoverMmsi != null) {
      this._hoverMmsi = null
      this._map.closeTooltip(this._tooltip)
    }
  },
})
