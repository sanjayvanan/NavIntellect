// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { canEdit, scopeLabel } from './scope'
import uiReducer, { commandHandled, issueCommand, selectObject } from './uiSlice'
import { initialPanelState, panelReducer } from './panelState'
import { ACTIONS, TOOLS, actionById, actionOfTool, isMultiPointTool, minPoints, stepHint, toolById } from './tools/registry'
import pinsReducer, { createPin, deletePin, movePin } from './pins/pinsSlice'
import { DEFAULT_PIN_STYLE, GLYPHS, PIN_ICONS, pinSvg } from './pins/pinStyle'
import { newPinForm, pinBodyFrom, pinFormFrom } from './pins/pinFormModel'
import { zoneBodyFrom } from './geofences/zoneFormModel'
import { describeObject, objectTypeOf, shapeFromDrawing, typeGlyphSvg } from './objectTypes'

const feature = (id, props = {}, coordinates = [10, 20]) => ({ type: 'Feature', id, geometry: { type: 'Point', coordinates }, properties: { id, ...props } })

describe('scope rules', () => {
  it('lets owners edit personal objects and only operators edit shared ones', () => {
    const personal = feature('a', { scope: 'personal' })
    const shared = feature('b', { scope: 'shared' })
    expect(canEdit(personal, { role: 'viewer' })).toBe(true)
    expect(canEdit(shared, { role: 'viewer' })).toBe(false)
    expect(canEdit(shared, { role: 'operator' })).toBe(true)
    expect(scopeLabel(feature('c', { scope: 'shared', preset: true }))).toBe('Preset')
  })
})

describe('tool registry', () => {
  it('has unique ids, a handler type for every tool and actions that reference real tools', () => {
    expect(new Set(TOOLS.map((t) => t.id)).size).toBe(TOOLS.length)
    for (const t of TOOLS) {
      expect(['shape', 'measure', 'pin']).toContain(t.type)
      expect(t.label && t.Icon && actionById(t.action)).toBeTruthy()
      if (t.type !== 'pin') expect(t.mode).toBeTruthy()
    }
    for (const a of ACTIONS) for (const id of a.tools) expect(toolById(id)?.action).toBe(a.id)
    expect(actionOfTool('rectangle').id).toBe('zone')
    expect(isMultiPointTool(toolById('polygon'))).toBe(true)
    expect(minPoints(toolById('polygon'))).toBe(3)
    expect(minPoints(toolById('ruler'))).toBe(2)
  })

  it('gives a next-step hint that follows the drawing', () => {
    const polygon = toolById('polygon')
    expect(stepHint(polygon, { vertices: 0 })).toMatch(/first corner/)
    expect(stepHint(polygon, { vertices: 2 })).toMatch(/corner 3/)
    expect(stepHint(polygon, { vertices: 3 })).toMatch(/finish/)
    expect(stepHint(toolById('circle'), { vertices: 1 })).toMatch(/radius/)
    expect(stepHint(toolById('pin'), null)).toMatch(/pin/)
  })
})

describe('map-objects UI state', () => {
  it('tracks selection and one-shot commands', () => {
    let s = uiReducer(undefined, selectObject({ type: 'pin', id: 'p1' }))
    s = uiReducer(s, issueCommand({ kind: 'dropPin', latlng: { lat: 1, lng: 2 } }))
    expect(s.command).toMatchObject({ kind: 'dropPin', seq: 1 })
    s = uiReducer(s, commandHandled(99)) // stale seq: ignored
    expect(s.command).not.toBeNull()
    s = uiReducer(s, commandHandled(1))
    expect(s.command).toBeNull()
    s = uiReducer(s, { type: 'pins/delete/fulfilled', payload: 'p1' })
    expect(s.selection).toBeNull()
    s = uiReducer(uiReducer(s, selectObject({ type: 'zone', id: 'z' })), { type: 'auth/logout/fulfilled' })
    expect(s).toEqual({ selection: null, command: null })
  })

  it('panel state machine: tools, drafts, redraw', () => {
    let s = panelReducer(initialPanelState, { type: 'toolStarted', tool: 'pin' })
    expect(s.tool).toBe('pin')
    s = panelReducer(s, { type: 'show', view: { kind: 'pinDraft', latlng: { lat: 1, lng: 1 } } })
    expect(s.tool).toBeNull()
    s = panelReducer(s, { type: 'movePinDraft', latlng: { lat: 2, lng: 2 } })
    expect(s.view.latlng).toEqual({ lat: 2, lng: 2 })
    s = panelReducer(s, { type: 'redrawn', redraw: {} }) // not editing a zone: ignored
    expect(s.view.kind).toBe('pinDraft')
    s = panelReducer(s, { type: 'show', view: { kind: 'zoneEdit', zoneId: 'z', redraw: null } })
    s = panelReducer(s, { type: 'toolStarted', tool: 'polygon', keepView: true })
    expect(s.view.kind).toBe('zoneEdit')
    s = panelReducer(s, { type: 'redrawn', redraw: { geometry: 'g' } })
    expect(s.view.redraw).toEqual({ geometry: 'g' })
    s = panelReducer(panelReducer(s, { type: 'saving' }), { type: 'failed', error: 'nope' })
    expect(s).toMatchObject({ saving: false, error: 'nope' })
  })
})

describe('pins', () => {
  const pending = (thunk, arg) => ({ type: thunk.pending.type, meta: { arg } })
  const rejected = (thunk, arg, payload) => ({ type: thunk.rejected.type, meta: { arg }, payload })

  it('moves pins optimistically and reverts when saving fails', () => {
    let s = pinsReducer(undefined, { type: createPin.fulfilled.type, payload: feature('p1', { name: 'A' }, [1, 2]) })
    const arg = { id: 'p1', latlng: { lat: 5, lng: 6 }, previous: [1, 2] }
    s = pinsReducer(s, pending(movePin, arg))
    expect(s.items[0].geometry.coordinates).toEqual([6, 5])
    s = pinsReducer(s, rejected(movePin, arg, 'offline'))
    expect(s.items[0].geometry.coordinates).toEqual([1, 2])
    expect(s.error).toMatch(/offline/)
    s = pinsReducer(s, { type: deletePin.fulfilled.type, payload: 'p1' })
    expect(s.items).toEqual([])
  })

  it('form model round-trips to the API body', () => {
    const body = pinBodyFrom({ ...newPinForm(), name: '  Buoy ', description: ' ', icon: 'anchor' })
    expect(body).toEqual({ name: 'Buoy', description: null, style: { color: DEFAULT_PIN_STYLE.color, icon: 'anchor' }, scope: 'personal' })
    const back = pinFormFrom(feature('p', { name: 'Buoy', scope: 'shared', style: { color: '#ff0000', icon: 'flag' } }))
    expect(back).toMatchObject({ name: 'Buoy', scope: 'shared', color: '#ff0000', icon: 'flag', description: '' })
  })

  it('renders safe marker SVG for any stored style', () => {
    expect(PIN_ICONS).toEqual(Object.keys(GLYPHS))
    const svg = pinSvg({ color: '"><script>', icon: 'nope' })
    expect(svg).not.toContain('<script>')
    expect(svg).toContain(DEFAULT_PIN_STYLE.color)
  })
})

describe('zone form model', () => {
  it('only sends non-default alert rules', () => {
    const body = zoneBodyFrom({
      name: ' Box ',
      kind: 'port',
      color: '#16c5d8',
      description: '',
      scope: 'personal',
      active: true,
      rules: { alert_on_enter: true, alert_on_exit: false, max_speed: '12', loiter_minutes: '' },
    })
    expect(body).toEqual({
      name: 'Box',
      kind: 'port',
      color: '#16c5d8',
      description: null,
      scope: 'personal',
      active: true,
      rules: { alert_on_exit: false, max_speed: 12 },
    })
  })
})

describe('object types', () => {
  const zone = (shape, shape_meta = {}, extra = {}) => ({
    type: 'Feature',
    id: 'z',
    geometry: { type: 'MultiPolygon', coordinates: [] },
    properties: { shape, shape_meta, area_nm2: '25.4', ...extra },
  })

  it('names pins as points and zones by the shape they were drawn as', () => {
    expect(objectTypeOf(feature('p', {}, [72.8, 18.9])).id).toBe('point')
    expect(objectTypeOf(zone('circle')).id).toBe('circle')
    expect(objectTypeOf(zone('rectangle')).id).toBe('rectangle')
    expect(objectTypeOf(zone(undefined)).id).toBe('polygon') // older zones without a shape
  })

  it('describes each type with its own figures', () => {
    expect(describeObject(feature('p', {}, [72.8, -18.9])).facts).toEqual(['18.9000° S, 72.8000° E'])
    expect(describeObject(zone('polygon', { corners: 5 })).facts).toEqual(['5 corners', '25.4 nm²'])
    expect(describeObject(zone('rectangle', { width_nm: 3.1, height_nm: 2 })).facts).toEqual(['3.10 nm × 2.00 nm', '25.4 nm²'])
    expect(describeObject(zone('circle', { radius_nm: 2.84 })).facts).toEqual(['r 2.84 nm', '25.4 nm²'])
  })

  it('captures shape and figures from a finished drawing', () => {
    const pts = [{ lat: 0, lng: 0 }, { lat: 0, lng: 1 }, { lat: 1, lng: 1 }, { lat: 1, lng: 0 }]
    expect(shapeFromDrawing('polygon', pts, {})).toEqual({ shape: 'polygon', shape_meta: { corners: 4 } })
    expect(shapeFromDrawing('rectangle', pts, { widthNm: 60.0412, heightNm: 60.04 })).toEqual({
      shape: 'rectangle',
      shape_meta: { width_nm: 60.04, height_nm: 60.04 },
    })
    expect(shapeFromDrawing('circle', [], { radiusNm: 0.001 }, { lat: 10, lng: 370.5 })).toEqual({
      shape: 'circle',
      shape_meta: { radius_nm: 0.01, center: [10.5, 10] }, // never 0; longitude wrapped
    })
  })

  it('only puts a valid colour into label SVG', () => {
    expect(typeGlyphSvg('circle', '#ff0000')).toContain('stroke="#ff0000"')
    expect(typeGlyphSvg('circle', '"><script>')).not.toContain('<script>')
  })
})
