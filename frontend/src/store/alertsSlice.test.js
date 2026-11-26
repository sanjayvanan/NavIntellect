// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest'
import reducer, {
  MAX_ALERTS,
  alertReceived,
  alertsUserChanged,
  dismissToast,
  fetchAlerts,
  markAllRead,
  mergeAlerts,
  notificationsPanelToggled,
  selectUnreadCount,
} from './alertsSlice'
import shipReducer, { hideTrack, setSelectedShip, showTrack, trackStatus } from './shipSlice'
import { trackToLatLngs } from '../services/tracks'
import { describeAlert, timeAgo } from '../utils/alertText'

const at = (min) => new Date(Date.UTC(2026, 10, 25, 12, min)).toISOString()
const alert = (id, min, extra = {}) => ({ id, type: 'zone_enter', severity: 'info', mmsi: 1, created_at: at(min), ...extra })
const unread = (alerts) => selectUnreadCount({ alerts })

beforeEach(() => localStorage.clear())

describe('alerts', () => {
  it('merges newest first without duplicates, keeping at most MAX_ALERTS', () => {
    const merged = mergeAlerts([alert('a', 1), alert('b', 3)], [alert('c', 2), alert('a', 1, { zone_name: 'Z' })])
    expect(merged.map((a) => a.id)).toEqual(['b', 'c', 'a'])
    expect(merged[2].zone_name).toBe('Z')
    const many = Array.from({ length: MAX_ALERTS + 20 }, (_, i) => alert(`x${i}`, i))
    expect(mergeAlerts([], many)).toHaveLength(MAX_ALERTS)
    expect(mergeAlerts([], many)[0].id).toBe(`x${MAX_ALERTS + 19}`)
  })

  it('counts unread, pops up live alerts once and clears them when read', () => {
    let s = reducer(undefined, alertsUserChanged('u1'))
    s = reducer(s, alertReceived(alert('a', 1)))
    s = reducer(s, alertReceived(alert('a', 1))) // repeated over the socket
    s = reducer(s, alertReceived(alert('b', 2)))
    expect(s.items.map((a) => a.id)).toEqual(['b', 'a'])
    expect(s.toasts).toEqual(['b', 'a'])
    expect(unread(s)).toBe(2)

    s = reducer(s, dismissToast('a'))
    expect(s.toasts).toEqual(['b'])
    s = reducer(s, markAllRead())
    expect(unread(s)).toBe(0)
    expect(s.toasts).toEqual([])
  })

  it('keeps read state per user in this browser', () => {
    let s = reducer(undefined, alertsUserChanged('u1'))
    s = reducer(s, markAllRead())
    const readAt = s.lastReadAt
    expect(readAt).toBeGreaterThan(0)
    expect(reducer(undefined, alertsUserChanged('u1')).lastReadAt).toBe(readAt)
    expect(reducer(undefined, alertsUserChanged('u2')).lastReadAt).toBe(0)
  })

  it('shows no pop-ups while the panel is open and marks all read on open and close', () => {
    let s = reducer(reducer(undefined, alertsUserChanged('u1')), notificationsPanelToggled(true))
    s = reducer(s, alertReceived(alert('new', 59)))
    expect(s.toasts).toEqual([])
    s = reducer(s, notificationsPanelToggled(false))
    expect(unread(s)).toBe(0)
  })

  it('pops up polled alerts the socket missed, but not the first load', () => {
    const first = fetchAlerts.fulfilled([alert('a', 1)], 'r1', {})
    let s = reducer(reducer(undefined, alertsUserChanged('u1')), first)
    expect(s.toasts).toEqual([])
    s = reducer(s, fetchAlerts.fulfilled([alert('a', 1), alert('b', 2)], 'r2', { since: at(1) }))
    expect(s.toasts).toEqual(['b'])
  })

  it('describes alerts in plain words', () => {
    expect(describeAlert(alert('a', 1, { vessel_name: 'MAERSK X', zone_name: 'Near britain', details: { sog: 12.34 } }))).toEqual({
      vessel: 'MAERSK X', action: 'entered', zone: 'Near britain', extra: '12.3 kn',
    })
    expect(describeAlert(alert('a', 1, { type: 'zone_exit', mmsi: 419 })).vessel).toBe('MMSI 419')
    expect(describeAlert(alert('a', 1, { type: 'speeding', details: { sog: 14, max_speed: 8 } })).extra).toBe('14.0 kn (limit 8.0 kn)')
    const now = Date.parse(at(30))
    expect(timeAgo(at(30), now)).toBe('just now')
    expect(timeAgo(at(20), now)).toBe('10m ago')
  })
})

describe('track history', () => {
  it('turns the track Feature into Leaflet lines and timed points', () => {
    expect(trackToLatLngs({ geometry: null, properties: {} })).toEqual({ segments: [], points: [] })
    expect(trackToLatLngs({ geometry: { type: 'Point', coordinates: [72.8, 18.9] }, properties: { times: [5] } })).toEqual({
      segments: [[[18.9, 72.8]]], points: [{ lat: 18.9, lng: 72.8, time: 5 }],
    })
    const line = trackToLatLngs({
      geometry: { type: 'LineString', coordinates: [[72.8, 18.9], [72.9, 19.0]] },
      properties: { times: [1, 2] },
    })
    expect(line.segments).toEqual([[[18.9, 72.8], [19.0, 72.9]]])
    expect(line.points.map((p) => p.time)).toEqual([1, 2])
  })

  it('splits the line where it crosses the antimeridian and thins very long tracks', () => {
    const crossing = trackToLatLngs({ geometry: { type: 'LineString', coordinates: [[179.5, 10], [179.9, 10], [-179.8, 10]] } })
    expect(crossing.segments).toEqual([[[10, 179.5], [10, 179.9]], [[10, -179.8]]])
    expect(crossing.points[0].time).toBeNull()

    const coords = Array.from({ length: 12000 }, (_, i) => [i / 1000, 0])
    const thinned = trackToLatLngs({ geometry: { type: 'LineString', coordinates: coords } })
    expect(thinned.points).toHaveLength(5000)
    expect(thinned.points[0].lng).toBe(0)
    expect(thinned.points[4999].lng).toBe(11.999) // keeps the latest position
  })

  it('shows the track for the selected ship only', () => {
    let s = shipReducer(undefined, setSelectedShip({ mmsi: 1, latitude: 0, longitude: 0 }))
    s = shipReducer(s, showTrack({ mmsi: 1, hours: 6 }))
    expect(s.track).toMatchObject({ mmsi: 1, hours: 6, status: 'loading' })
    s = shipReducer(s, trackStatus({ mmsi: 1, status: 'ready', points: 40 }))
    expect(s.track).toMatchObject({ status: 'ready', points: 40 })
    s = shipReducer(s, trackStatus({ mmsi: 2, status: 'failed', error: 'late answer' }))
    expect(s.track.status).toBe('ready')

    s = shipReducer(s, setSelectedShip({ mmsi: 1, latitude: 1, longitude: 1 })) // same ship, new position
    expect(s.track.mmsi).toBe(1)
    s = shipReducer(s, setSelectedShip({ mmsi: 2, latitude: 1, longitude: 1 }))
    expect(s.track.mmsi).toBeNull()
    s = shipReducer(shipReducer(s, showTrack({ mmsi: 2, hours: 72 })), hideTrack())
    expect(s.track).toMatchObject({ mmsi: null, hours: 72 })
  })
})
