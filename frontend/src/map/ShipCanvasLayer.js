import L from 'leaflet'
import { shipCategories } from '../config/shipCategories'

// The ship arrow from assets/ShipIcon.svg (viewBox 38x33, nose pointing east), centred.
const ARROW = [[37, 16.6], [1.2, 1.7], [8.1, 16.6], [1.2, 31.6]].map(([x, y]) => [x - 19, y - 16.6])
const SELECTED_COLOR = '#f44336'
const HIT_RADIUS_PX = 10

// Clustering: ships within the same CLUSTER_CELL_PX square (in world pixels, so clusters stay
// stable while panning) are drawn as one bubble, until CLUSTER_MAX_ZOOM.
const CLUSTER_CELL_PX = 60
const CLUSTER_MAX_ZOOM = 12
// Same colour scheme as Leaflet.markercluster: small / medium / large clusters.
const CLUSTER_STYLES = [
  { max: 10, radius: 14, outer: 'rgba(181, 226, 140, 0.6)', inner: 'rgba(110, 204, 57, 0.85)' },
  { max: 100, radius: 17, outer: 'rgba(241, 211, 87, 0.6)', inner: 'rgba(240, 194, 12, 0.85)' },
  { max: Infinity, radius: 20, outer: 'rgba(253, 156, 115, 0.6)', inner: 'rgba(241, 128, 23, 0.85)' },
]

// Names are drawn next to ships from this zoom on (and only when few enough are visible).
const LABEL_MIN_ZOOM = 11
const LABEL_MAX_COUNT = 400

const SIZE_FACTOR = { small: 0.75, medium: 1, large: 1.35 }

const colorOf = (ship) => (shipCategories[ship.message_type__id] || shipCategories.default).color

/** Arrow length in px for a zoom level: small when zoomed out, bigger close in. */
const arrowSize = (zoom) => (zoom < 4 ? 8 : zoom < 8 ? 10 : 13)

/**
 * Draws all ships on one <canvas> instead of one DOM marker per ship, so thousands of ships pan
 * and update at 60 fps. Optional clustering into count bubbles, name labels and icon size.
 * Handles hit-testing itself: click ship -> onSelect(ship), click cluster -> zoom into it,
 * click elsewhere -> onEmptyClick(); hover -> pointer cursor + tooltip.
 */
export const ShipCanvasLayer = L.Layer.extend({
  options: {
    clustering: true,
    size: 'medium',
    labels: true,
    dark: false,
  },

  initialize(options) {
    L.setOptions(this, options)
    this._ships = []
    this._selected = null
    this._hits = [] // [x, y, ship] of individual ships drawn in the last frame
    this._clusterHits = [] // [x, y, radius, cluster] of cluster bubbles drawn in the last frame
    this._raf = null
  },

  onAdd(map) {
    if (!map.getPane('ships')) {
      const pane = map.createPane('ships')
      pane.style.zIndex = 450 // above tiles/overlays, below popups
      pane.style.pointerEvents = 'none'
    }
    // leaflet-zoom-animated: during a zoom animation the canvas is scaled with the map (see
    // _onAnimZoom) instead of being hidden, so ships never blink out; it is redrawn at zoomend.
    this._canvas = L.DomUtil.create('canvas', 'ship-canvas leaflet-zoom-animated', map.getPane('ships'))
    this._ctx = this._canvas.getContext('2d')
    this._tooltip = L.tooltip({ direction: 'top', offset: [0, -8], className: 'ship-hover-tooltip' })
    map.on('move zoomend resize viewreset', this._schedule, this)
    map.on('click', this._onClick, this)
    map.on('mousemove', this._onMouseMove, this)
    map.on('mouseout', this._clearHover, this)
    if (map._zoomAnimated) map.on('zoomanim', this._onAnimZoom, this)
    this._schedule()
  },

  onRemove(map) {
    map.off('move zoomend resize viewreset', this._schedule, this)
    map.off('click', this._onClick, this)
    map.off('mousemove', this._onMouseMove, this)
    map.off('mouseout', this._clearHover, this)
    map.off('zoomanim', this._onAnimZoom, this)
    this._clearHover()
    if (this._raf) cancelAnimationFrame(this._raf)
    L.DomUtil.remove(this._canvas)
  },

  /** ships: legacy rows; selected: the selected ship (drawn on top, never clustered). */
  setData(ships, selected) {
    this._ships = ships || []
    this._selected = selected || null
    this._schedule()
  },

  /** Display options: { clustering, size: 'small'|'medium'|'large', labels, dark }. */
  setDisplay(display) {
    L.setOptions(this, display)
    this._schedule()
  },

  _schedule() {
    if (this._raf || !this._map) return
    this._raf = requestAnimationFrame(() => {
      this._raf = null
      this._draw()
    })
  },

  /**
   * Zoom animation: scale/translate the last frame like Leaflet's own vector renderer does
   * (L.Renderer._updateTransform), then redraw crisply on zoomend.
   */
  _onAnimZoom(e) {
    const map = this._map
    if (this._drawnCenter == null) return
    const scale = map.getZoomScale(e.zoom, this._drawnZoom)
    const topLeft = map
      .getSize()
      .multiplyBy(0.5 * -scale)
      .add(map.project(this._drawnCenter, e.zoom))
      .subtract(map._getNewPixelOrigin(e.center, e.zoom))
    L.DomUtil.setTransform(this._canvas, topLeft, scale)
  },

  _draw() {
    const map = this._map
    // Mid zoom-animation the canvas is being CSS-scaled; redrawing now would make it jump.
    // zoomend schedules the next draw.
    if (map._animatingZoom) return
    this._drawnCenter = map.getCenter()
    this._drawnZoom = map.getZoom()
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

    const zoom = map.getZoom()
    const len = arrowSize(zoom) * (SIZE_FACTOR[this.options.size] || 1)
    const selectedMmsi = this._selected?.mmsi
    const origin = map.getPixelBounds().min // world pixel of the container's top-left corner
    const margin = 30

    // 1. Project visible ships once (world pixels -> container pixels).
    const visible = []
    for (const ship of this._ships) {
      if (ship.mmsi === selectedMmsi || ship.latitude == null) continue
      const w = map.project([ship.latitude, ship.longitude], zoom)
      const x = w.x - origin.x
      const y = w.y - origin.y
      if (x < -margin || y < -margin || x > size.x + margin || y > size.y + margin) continue
      visible.push({ ship, x, y, wx: w.x, wy: w.y })
    }

    // 2. Cluster (optional): group by world-pixel grid cell.
    let singles = visible
    const clusters = []
    if (this.options.clustering && zoom < CLUSTER_MAX_ZOOM && visible.length > 1) {
      const cells = new Map()
      for (const v of visible) {
        const key = `${Math.floor(v.wx / CLUSTER_CELL_PX)}:${Math.floor(v.wy / CLUSTER_CELL_PX)}`
        const cell = cells.get(key)
        if (cell) cell.push(v)
        else cells.set(key, [v])
      }
      singles = []
      for (const members of cells.values()) {
        if (members.length === 1) {
          singles.push(members[0])
          continue
        }
        let sx = 0
        let sy = 0
        for (const m of members) {
          sx += m.x
          sy += m.y
        }
        clusters.push({ x: sx / members.length, y: sy / members.length, members })
      }
    }

    // 3. Draw ships, then clusters, labels and the selected ship on top.
    const hits = []
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.45)'
    for (const v of singles) {
      this._arrow(ctx, dpr, v.x, v.y, v.ship.course_over_ground || 0, len, colorOf(v.ship))
      hits.push([v.x, v.y, v.ship])
    }

    const clusterHits = []
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.font = 'bold 11px system-ui, -apple-system, sans-serif'
    for (const c of clusters) {
      const n = c.members.length
      const style = CLUSTER_STYLES.find((s) => n < s.max)
      ctx.beginPath()
      ctx.arc(c.x, c.y, style.radius, 0, Math.PI * 2)
      ctx.fillStyle = style.outer
      ctx.fill()
      ctx.beginPath()
      ctx.arc(c.x, c.y, style.radius - 4, 0, Math.PI * 2)
      ctx.fillStyle = style.inner
      ctx.fill()
      ctx.fillStyle = '#1a1a1a'
      ctx.fillText(n > 999 ? `${Math.round(n / 100) / 10}k` : String(n), c.x, c.y)
      clusterHits.push([c.x, c.y, style.radius, c])
    }

    if (this.options.labels && zoom >= LABEL_MIN_ZOOM && singles.length <= LABEL_MAX_COUNT) {
      ctx.textAlign = 'left'
      ctx.font = '11px system-ui, -apple-system, sans-serif'
      ctx.lineWidth = 3
      ctx.strokeStyle = this.options.dark ? 'rgba(0, 0, 0, 0.8)' : 'rgba(255, 255, 255, 0.9)'
      ctx.fillStyle = this.options.dark ? '#f2f2f2' : '#1a1a1a'
      for (const v of singles) {
        const name = v.ship.track_name || `MMSI ${v.ship.mmsi}`
        ctx.strokeText(name, v.x + len * 0.7 + 3, v.y)
        ctx.fillText(name, v.x + len * 0.7 + 3, v.y)
      }
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
    this._clusterHits = clusterHits
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

  /** What is under a container point: { ship } (nearest within HIT_RADIUS_PX), { cluster } or null. */
  _hitTest(point) {
    // Selected ship and single ships first (drawn on top of nothing else), then clusters.
    let best = null
    let bestD = HIT_RADIUS_PX * HIT_RADIUS_PX
    for (const [x, y, ship] of this._hits) {
      const d = (x - point.x) ** 2 + (y - point.y) ** 2
      if (d <= bestD) {
        bestD = d
        best = ship
      }
    }
    if (best) return { ship: best }
    for (const [x, y, r, cluster] of this._clusterHits) {
      if ((x - point.x) ** 2 + (y - point.y) ** 2 <= r * r) return { cluster }
    }
    return null
  },

  _zoomToCluster(cluster) {
    const map = this._map
    const lats = cluster.members.map((m) => m.ship.latitude)
    const lons = cluster.members.map((m) => m.ship.longitude)
    const bounds = L.latLngBounds([Math.min(...lats), Math.min(...lons)], [Math.max(...lats), Math.max(...lons)])
    const zoom = map.getZoom()
    if (bounds.getNorthEast().equals(bounds.getSouthWest())) {
      map.flyTo(bounds.getCenter(), Math.min(zoom + 2, map.getMaxZoom()))
    } else {
      map.flyToBounds(bounds.pad(0.25), { maxZoom: Math.min(zoom + 4, map.getMaxZoom()) })
    }
  },

  _onClick(e) {
    const hit = this._hitTest(e.containerPoint)
    if (hit?.ship) this.options.onSelect?.(hit.ship)
    else if (hit?.cluster) this._zoomToCluster(hit.cluster)
    else this.options.onEmptyClick?.()
  },

  _onMouseMove(e) {
    const hit = this._hitTest(e.containerPoint)
    if (!hit) {
      this._clearHover()
      return
    }
    this._map.getContainer().style.cursor = 'pointer'
    const key = hit.ship ? `s${hit.ship.mmsi}` : `c${hit.cluster.x},${hit.cluster.y}`
    if (this._hoverKey === key) return
    this._hoverKey = key
    if (hit.ship) {
      this._tooltip.setLatLng([hit.ship.latitude, hit.ship.longitude]).setContent(hit.ship.track_name || `MMSI ${hit.ship.mmsi}`)
    } else {
      const n = hit.cluster.members.length
      this._tooltip
        .setLatLng(this._map.containerPointToLatLng([hit.cluster.x, hit.cluster.y]))
        .setContent(`${n} ships · click to zoom in`)
    }
    this._map.openTooltip(this._tooltip)
  },

  _clearHover() {
    if (!this._map) return
    this._map.getContainer().style.cursor = ''
    if (this._hoverKey != null) {
      this._hoverKey = null
      this._map.closeTooltip(this._tooltip)
    }
  },
})
