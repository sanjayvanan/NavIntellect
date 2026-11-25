// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import reducer, { defaults, sanitizeSettings, setHidden } from './themeSlice'

describe('settings sanitising', () => {
  it('fills defaults and drops invalid values', () => {
    const s = sanitizeSettings({ mode: 'purple', shipDensity: 99, view: { lat: 'x' }, overlays: ['nope'], extra: 1 })
    expect(s.mode).toBe(defaults.mode)
    expect(s.shipDensity).toBe(defaults.shipDensity)
    expect(s.view).toBeNull()
    expect(s.overlays).toEqual([])
    expect(s.hidden).toEqual({ zone: [], pin: [] })
  })

  it('wraps and clamps the saved map view', () => {
    expect(sanitizeSettings({ view: { lat: 95, lng: 370, zoom: 40 } }).view).toEqual({ lat: 85, lng: 10, zoom: 18 })
  })

  it('carries the old hiddenZones list over to hidden.zone', () => {
    const s = sanitizeSettings({ hiddenZones: ['a', 'b', 7] })
    expect(s.hidden).toEqual({ zone: ['a', 'b'], pin: [] })
    expect(s).not.toHaveProperty('hiddenZones')
    // the new form wins when both are present
    expect(sanitizeSettings({ hiddenZones: ['old'], hidden: { zone: ['new'], pin: ['p'] } }).hidden).toEqual({ zone: ['new'], pin: ['p'] })
  })

  it('hides and shows map objects per type', () => {
    let state = sanitizeSettings({})
    state = reducer(state, setHidden({ type: 'pin', ids: ['p1', 'p2'], hidden: true }))
    state = reducer(state, setHidden({ type: 'pin', ids: ['p1'], hidden: false }))
    state = reducer(state, setHidden({ type: 'bogus', ids: ['x'], hidden: true }))
    expect(state.hidden).toEqual({ zone: [], pin: ['p2'] })
  })
})
