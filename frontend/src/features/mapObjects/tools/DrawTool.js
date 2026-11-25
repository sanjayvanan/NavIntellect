import L from 'leaflet'
import {
  bearingDeg,
  circlePolygon,
  distanceNm,
  formatArea,
  formatBearing,
  formatNm,
  pathLengthNm,
  polygonAreaNm2,
} from '../../../utils/geo'
import { enterToolMode } from './interaction'

/**
 * Interactive drawing on the map with live nautical measurements.
 *
 * Modes:
 *  - polygon:   click to add vertices; click the first vertex, double-click or Enter to finish
 *  - rectangle: click one corner, then the opposite corner
 *  - circle:    click the centre, then click at the radius
 *  - ruler:     like polygon but open; measures a route leg by leg (not saved)
 * Keys while drawing: Esc cancels, Backspace undoes the last vertex, Enter finishes.
 *
 * Every placed leg carries a label with its length; the cursor shows the live leg from the last
 * point (distance + true bearing) and the running total / area.
 *
 * Callbacks: onChange(readout) on every update, onFinish({ mode, points, readout, origin }), onCancel().
 * `origin` is the first click (the centre, for circles).
 * `start(mode, { from })` begins with a first point already placed (e.g. "Measure from here").
 */
const SNAP_PX = 12 // click this close to the first vertex to close the polygon
const COLOR = '#16c5d8'

export class DrawTool {
  constructor(map, { onChange, onFinish, onCancel } = {}) {
    this.map = map
    this.cb = { onChange, onFinish, onCancel }
    this.mode = null
    this.points = []
    this.cursor = null
    this.group = L.layerGroup()
    this.resultGroup = L.layerGroup().addTo(map) // finished shape / ruler kept on screen until cleared
  }

  get active() {
    return this.mode !== null
  }

  start(mode, { from } = {}) {
    this.stop()
    this.clearResult()
    this.mode = mode
    this.points = from ? [L.latLng(from)] : []
    this.cursor = null
    const map = this.map
    this.group.addTo(map)
    this._exitToolMode = enterToolMode(map, { onKey: (e) => this._onKey(e) })
    map.on('click', this._onClick, this)
    map.on('dblclick', this._onDblClick, this)
    map.on('mousemove', this._onMove, this)
    this._tooltip = L.tooltip({ permanent: true, direction: 'right', offset: [16, 0], className: 'draw-cursor-tip', opacity: 1 })
    this._render()
  }

  /** Leaves drawing mode (keeps any finished result on screen). */
  stop() {
    if (!this.mode) return
    const map = this.map
    map.off('click', this._onClick, this)
    map.off('dblclick', this._onDblClick, this)
    map.off('mousemove', this._onMove, this)
    this._exitToolMode?.()
    this._exitToolMode = null
    if (this._tooltip) map.closeTooltip(this._tooltip)
    this.group.clearLayers()
    this.group.remove()
    this.mode = null
  }

  cancel() {
    if (!this.mode) return
    this.stop()
    this.cb.onCancel?.()
  }

  undo() {
    if (!this.mode || !this.points.length) return
    this.points.pop()
    this._render()
  }

  clearResult() {
    this.resultGroup.clearLayers()
  }

  destroy() {
    this.stop()
    this.resultGroup.remove()
  }

  // ---------- events ----------

  _onKey(e) {
    if (e.key === 'Escape') {
      e.preventDefault()
      this.cancel()
    } else if (e.key === 'Backspace' || e.key === 'Delete') {
      e.preventDefault()
      this.undo()
    } else if (e.key === 'Enter') {
      e.preventDefault()
      this.finish()
    }
  }

  _onMove(e) {
    this.cursor = e.latlng
    this._render()
  }

  _onClick(e) {
    const p = e.latlng
    const pts = this.points
    if (this.mode === 'rectangle' || this.mode === 'circle') {
      if (!pts.length) pts.push(p)
      else if (this._samePixel(pts[0], p)) return
      else {
        pts.push(p)
        this.finish()
        return
      }
    } else {
      // Close the polygon by clicking its first vertex.
      if (this.mode === 'polygon' && pts.length >= 3 && this._samePixel(pts[0], p, SNAP_PX)) {
        this.finish()
        return
      }
      // A double-click also fires two clicks on the same spot: never add a duplicate vertex.
      if (pts.length && this._samePixel(pts[pts.length - 1], p, 4)) return
      pts.push(p)
    }
    this._render()
  }

  _onDblClick(e) {
    L.DomEvent.stop(e)
    this.finish()
  }

  _samePixel(a, b, px = 4) {
    return this.map.latLngToContainerPoint(a).distanceTo(this.map.latLngToContainerPoint(b)) <= px
  }

  // ---------- geometry ----------

  /** Rectangle corners from two opposite corners (in drawing order). */
  static rectCorners(a, b) {
    return [a, L.latLng(a.lat, b.lng), b, L.latLng(b.lat, a.lng)]
  }

  /** Current shape vertices (for rectangle/circle: derived from the two clicks or the cursor). */
  _shapePoints(withCursor = true) {
    const pts = this.points
    const c = withCursor ? this.cursor : null
    if (this.mode === 'rectangle') {
      const b = pts[1] || c
      return pts[0] && b ? DrawTool.rectCorners(pts[0], b) : pts
    }
    if (this.mode === 'circle') {
      const edge = pts[1] || c
      if (!pts[0] || !edge) return pts
      return circlePolygon(pts[0], distanceNm(pts[0], edge)).map((q) => L.latLng(q.lat, q.lng))
    }
    return c ? [...pts, c] : pts
  }

  /** Live measurements for the panel and the cursor tooltip. */
  readout() {
    const pts = this.points
    const c = this.cursor
    const last = pts[pts.length - 1]
    const r = { mode: this.mode, vertices: pts.length }
    if (this.mode === 'rectangle') {
      const b = pts[1] || c
      if (pts[0] && b) {
        const [a, ab, , ba] = DrawTool.rectCorners(pts[0], b)
        r.widthNm = distanceNm(a, ab)
        r.heightNm = distanceNm(a, ba)
        const shape = DrawTool.rectCorners(pts[0], b)
        r.perimeterNm = pathLengthNm(shape, true)
        r.areaNm2 = polygonAreaNm2(shape)
      }
    } else if (this.mode === 'circle') {
      const edge = pts[1] || c
      if (pts[0] && edge) {
        r.radiusNm = distanceNm(pts[0], edge)
        r.bearing = bearingDeg(pts[0], edge)
        r.perimeterNm = 2 * Math.PI * r.radiusNm
        r.areaNm2 = Math.PI * r.radiusNm ** 2
      }
    } else {
      if (last && c) {
        r.legNm = distanceNm(last, c)
        r.bearing = bearingDeg(last, c)
      }
      const path = this._shapePoints(true)
      r.totalNm = pathLengthNm(path, false)
      if (this.mode === 'polygon' && path.length >= 3) {
        r.perimeterNm = pathLengthNm(path, true)
        r.areaNm2 = polygonAreaNm2(path)
      }
    }
    return r
  }

  finish() {
    const mode = this.mode
    if (!mode) return
    const minPts = mode === 'polygon' ? 3 : 2
    if (this.points.length < minPts) return // not enough to finish yet: keep drawing
    this.cursor = null
    const points = this._shapePoints(false)
    const readout = this.readout()
    this._origin = this.points[0] // circle centre / first corner
    this.stop()
    this._drawResult(mode, points, readout)
    const origin = this._origin ? { lat: this._origin.lat, lng: this._origin.lng } : null
    this.cb.onFinish?.({ mode, points: points.map((p) => ({ lat: p.lat, lng: p.lng })), readout, origin })
  }

  // ---------- rendering ----------

  _legLabel(a, b, group, cls = '') {
    const mid = L.latLng((a.lat + b.lat) / 2, (a.lng + b.lng) / 2)
    L.marker(mid, {
      interactive: false,
      keyboard: false,
      icon: L.divIcon({ className: `draw-leg-label ${cls}`, html: `<span>${formatNm(distanceNm(a, b))}</span>`, iconSize: null }),
    }).addTo(group)
  }

  _render() {
    const g = this.group
    g.clearLayers()
    const pts = this.points
    const c = this.cursor
    const mode = this.mode
    const style = { color: COLOR, weight: 2.5, interactive: false }

    if (mode === 'polygon' || mode === 'ruler') {
      if (pts.length >= 2) {
        L.polyline(pts, style).addTo(g)
        for (let i = 1; i < pts.length; i++) this._legLabel(pts[i - 1], pts[i], g)
      }
      if (pts.length && c) {
        L.polyline([pts[pts.length - 1], c], { ...style, dashArray: '6 6' }).addTo(g)
        if (mode === 'polygon' && pts.length >= 2) {
          L.polygon([...pts, c], { ...style, weight: 0, fillColor: COLOR, fillOpacity: 0.12 }).addTo(g)
          L.polyline([c, pts[0]], { ...style, weight: 1.5, opacity: 0.6, dashArray: '2 6' }).addTo(g)
        }
      }
      pts.forEach((p, i) =>
        L.circleMarker(p, {
          radius: i === 0 && mode === 'polygon' && pts.length >= 3 ? 7 : 5,
          color: '#fff',
          weight: 2,
          fillColor: i === 0 ? '#071b35' : COLOR,
          fillOpacity: 1,
          interactive: false,
        }).addTo(g),
      )
    } else if (pts[0]) {
      const shape = this._shapePoints(true)
      if (shape.length > 2) L.polygon(shape, { ...style, fillColor: COLOR, fillOpacity: 0.14, dashArray: '6 6' }).addTo(g)
      if (mode === 'circle' && (pts[1] || c)) {
        L.polyline([pts[0], pts[1] || c], { ...style, weight: 1.5 }).addTo(g)
        this._legLabel(pts[0], pts[1] || c, g, 'radius')
      }
      if (mode === 'rectangle' && shape.length === 4) {
        this._legLabel(shape[0], shape[1], g)
        this._legLabel(shape[1], shape[2], g)
      }
      L.circleMarker(pts[0], { radius: 5, color: '#fff', weight: 2, fillColor: '#071b35', fillOpacity: 1, interactive: false }).addTo(g)
    }

    // Cursor tooltip with the live numbers
    const r = this.readout()
    this.cb.onChange?.(r)
    if (!c) return
    const lines = []
    if (mode === 'circle') {
      if (r.radiusNm != null) lines.push(`<b>Radius ${formatNm(r.radiusNm)}</b>`, `Area ${formatArea(r.areaNm2)}`)
      else lines.push('Click the centre')
    } else if (mode === 'rectangle') {
      if (r.widthNm != null) lines.push(`<b>${formatNm(r.widthNm)} × ${formatNm(r.heightNm)}</b>`, `Area ${formatArea(r.areaNm2)}`)
      else lines.push('Click a corner')
    } else {
      if (r.legNm != null) {
        lines.push(`<b>${formatNm(r.legNm)}</b> · ${formatBearing(r.bearing)}`)
        if (pts.length >= 2) lines.push(`Total ${formatNm(r.totalNm)}`)
        if (r.areaNm2) lines.push(`Area ${formatArea(r.areaNm2)}`)
      } else lines.push(mode === 'ruler' ? 'Click the start point' : 'Click the first vertex')
      if (mode === 'polygon' && pts.length >= 3 && this._samePixel(pts[0], c, SNAP_PX)) lines.push('<i>Click to close</i>')
    }
    this._tooltip.setLatLng(c).setContent(lines.join('<br>'))
    if (!this.map.hasLayer(this._tooltip)) this._tooltip.addTo(this.map)
  }

  /** Keeps the finished ruler/shape on screen with its leg labels. */
  _drawResult(mode, points, readout) {
    const g = this.resultGroup
    const style = { color: COLOR, weight: 2.5, interactive: false }
    if (mode === 'ruler') {
      L.polyline(points, style).addTo(g)
      for (let i = 1; i < points.length; i++) this._legLabel(points[i - 1], points[i], g)
      points.forEach((p) => L.circleMarker(p, { radius: 4, color: '#fff', weight: 2, fillColor: COLOR, fillOpacity: 1, interactive: false }).addTo(g))
      L.marker(points[points.length - 1], {
        interactive: false,
        icon: L.divIcon({ className: 'draw-leg-label total', html: `<span>Total ${formatNm(readout.totalNm)}</span>`, iconSize: null }),
      }).addTo(g)
      return
    }
    L.polygon(points, { ...style, fillColor: COLOR, fillOpacity: 0.18 }).addTo(g)
    if (mode === 'polygon') {
      for (let i = 0; i < points.length; i++) this._legLabel(points[i], points[(i + 1) % points.length], g)
    }
  }
}
