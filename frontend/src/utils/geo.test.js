import { describe, expect, it } from 'vitest'
import {
  bearingDeg,
  circlePolygon,
  densify,
  distanceNm,
  formatArea,
  formatBearing,
  formatNm,
  outerRings,
  pathLengthNm,
  pointInRing,
  rhumbDistanceNm,
  polygonAreaNm2,
  toGeoJsonPolygon,
} from './geo'

describe('nautical geometry', () => {
  it('measures great-circle distance in nautical miles', () => {
    expect(distanceNm({ lat: 0, lng: 0 }, { lat: 1, lng: 0 })).toBeCloseTo(60.04, 1) // 1° of latitude
    const dover = { lat: 51.1279, lng: 1.3134 }
    const calais = { lat: 50.9513, lng: 1.8587 }
    expect(distanceNm(dover, calais)).toBeGreaterThan(22)
    expect(distanceNm(dover, calais)).toBeLessThan(24)
  })

  it('gives true bearings 0–360', () => {
    expect(bearingDeg({ lat: 0, lng: 0 }, { lat: 1, lng: 0 })).toBeCloseTo(0, 5)
    expect(bearingDeg({ lat: 0, lng: 0 }, { lat: 0, lng: 1 })).toBeCloseTo(90, 5)
    expect(bearingDeg({ lat: 0, lng: 0 }, { lat: 0, lng: -1 })).toBeCloseTo(270, 5)
  })

  it('computes path length and spherical polygon area', () => {
    const square = [
      { lat: 0, lng: 0 },
      { lat: 0, lng: 1 },
      { lat: 1, lng: 1 },
      { lat: 1, lng: 0 },
    ]
    expect(pathLengthNm(square, true)).toBeCloseTo(4 * 60.04, -1)
    expect(polygonAreaNm2(square)).toBeGreaterThan(3550)
    expect(polygonAreaNm2(square)).toBeLessThan(3650)
    expect(polygonAreaNm2(square.slice(0, 2))).toBe(0)
  })

  it('builds geodesic circles of the requested radius', () => {
    const centre = { lat: 60, lng: 10 }
    const ring = circlePolygon(centre, 10, 72)
    expect(ring).toHaveLength(72)
    for (const p of ring) expect(distanceNm(centre, p)).toBeCloseTo(10, 6)
    expect(polygonAreaNm2(ring)).toBeCloseTo(Math.PI * 100, -1)
  })

  it('measures rhumb lines (≥ great circle; exact along parallels and meridians)', () => {
    const a = { lat: 60, lng: 0 }
    const b = { lat: 60, lng: 10 }
    expect(rhumbDistanceNm(a, b)).toBeCloseTo(10 * 60.04 * Math.cos(Math.PI / 3), 0)
    expect(rhumbDistanceNm(a, b)).toBeGreaterThan(distanceNm(a, b))
    expect(rhumbDistanceNm({ lat: 0, lng: 5 }, { lat: 1, lng: 5 })).toBeCloseTo(distanceNm({ lat: 0, lng: 5 }, { lat: 1, lng: 5 }), 6)
  })

  it('densifies along the drawn (Mercator) line, keeping parallels straight', () => {
    const rect = [
      { lat: 60, lng: 0 },
      { lat: 60, lng: 10 },
      { lat: 62, lng: 10 },
      { lat: 62, lng: 0 },
    ]
    const dense = densify(rect, true, 25)
    expect(dense.length).toBeGreaterThan(rect.length)
    // every point added between the two 60°N corners stays on 60°N
    expect(dense.filter((p) => Math.abs(p.lat - 60) < 1e-9).length).toBeGreaterThan(2)
    for (let i = 1; i < dense.length; i++) expect(distanceNm(dense[i - 1], dense[i])).toBeLessThanOrEqual(25)
  })

  it('converts to a closed GeoJSON ring and handles wrapped longitudes', () => {
    const poly = toGeoJsonPolygon([
      { lat: 10, lng: 370 },
      { lat: 10, lng: 371 },
      { lat: 11, lng: 371 },
    ])
    expect(poly.coordinates[0]).toEqual([
      [10, 10],
      [11, 10],
      [11, 11],
      [10, 10],
    ])
    expect(() =>
      toGeoJsonPolygon([
        { lat: 10, lng: 179 },
        { lat: 10, lng: 181 },
        { lat: 11, lng: 181 },
      ]),
    ).toThrow(/180° meridian/)
    expect(outerRings(poly)[0]).toEqual([
      { lat: 10, lng: 10 },
      { lat: 10, lng: 11 },
      { lat: 11, lng: 11 },
    ])
  })

  it('hit-tests points in rings', () => {
    const ring = [
      { lat: 0, lng: 0 },
      { lat: 0, lng: 2 },
      { lat: 2, lng: 2 },
      { lat: 2, lng: 0 },
    ]
    expect(pointInRing({ lat: 1, lng: 1 }, ring)).toBe(true)
    expect(pointInRing({ lat: 3, lng: 1 }, ring)).toBe(false)
  })

  it('formats distances, areas and bearings', () => {
    expect(formatNm(0.05)).toBe('93 m')
    expect(formatNm(3.456)).toBe('3.46 nm')
    expect(formatNm(42.12)).toBe('42.1 nm')
    expect(formatNm(1234.5)).toBe('1,235 nm')
    expect(formatArea(3605.4)).toBe('3,605 nm²')
    expect(formatBearing(5.4)).toBe('005°T')
    expect(formatBearing(359.6)).toBe('000°T')
  })
})
