// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import L from 'leaflet'
import { normalisePositions, normX, normY, worldSize } from './projection'

describe('fast Web Mercator projection', () => {
  const points = [
    [0, 0],
    [51.5, -0.12],
    [-33.86, 151.2],
    [85.2, 179.9], // clamped like Leaflet
    [-89, -179],
    [18.9, 72.8],
  ]

  it('matches Leaflet’s map.project at integer and fractional zooms', () => {
    for (const zoom of [0, 3, 7.37, 12, 18]) {
      for (const [lat, lng] of points) {
        const expected = L.CRS.EPSG3857.latLngToPoint(L.latLng(lat, lng), zoom)
        expect(normX(lng) * worldSize(zoom)).toBeCloseTo(expected.x, 6)
        expect(normY(lat) * worldSize(zoom)).toBeCloseTo(expected.y, 6)
      }
    }
  })

  it('normalises arrays and marks missing positions as NaN', () => {
    const items = [{ lat: 0, lng: 0 }, { lat: null, lng: 3 }, { lat: 10, lng: 20 }]
    const { xs, ys } = normalisePositions(items, (i) => i.lat, (i) => i.lng)
    expect(xs).toBeInstanceOf(Float64Array)
    expect([xs[0], ys[0]]).toEqual([0.5, 0.5])
    expect(Number.isNaN(xs[1])).toBe(true)
    expect(xs[2]).toBeCloseTo(normX(20), 12)
  })
})
