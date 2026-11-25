import { describe, expect, it } from 'vitest'
import { coordsForClipboard, formatDecimal, toDMS } from './coords'

describe('coordinate formatting', () => {
  it('formats degrees/minutes/seconds with hemispheres', () => {
    expect(toDMS(18.9, true)).toBe(`18° 54' 0.00" N`)
    expect(toDMS(-33.8568, true)).toBe(`33° 51' 24.48" S`)
    expect(toDMS(-0.1276, false)).toBe(`0° 7' 39.36" W`)
    expect(toDMS(72.8, false, 1)).toBe(`72° 48' 0.0" E`)
  })

  it('never shows 60 seconds or 60 minutes after rounding', () => {
    expect(toDMS(10.9999999, true)).toBe(`11° 0' 0.00" N`)
    expect(toDMS(10.49999999, true)).toBe(`10° 30' 0.00" N`)
  })

  it('formats decimal degrees and clipboard text', () => {
    expect(formatDecimal({ lat: 18.9, lng: 72.8 })).toBe('18.90000, 72.80000')
    expect(coordsForClipboard({ lat: 1.5, lng: 103.8 })).toBe(`1° 30' 0.00" N 103° 48' 0.00" E (1.500000, 103.800000)`)
  })
})
