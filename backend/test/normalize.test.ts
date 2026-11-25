import { describe, expect, it } from 'vitest';
import { cleanText, normalize, parseAisstreamTime } from '../src/ingest/normalize.js';
import type { PositionMsg, StaticMsg } from '../src/ingest/types.js';
import { classBReport, positionReport, shipStaticData } from './fixtures/messages.js';

describe('parseAisstreamTime', () => {
  const now = new Date('2026-01-01T12:00:00Z');
  it('parses Go-formatted UTC times with nanoseconds', () => {
    expect(parseAisstreamTime('2025-12-31 23:59:58.123456789 +0000 UTC', now).toISOString()).toBe('2025-12-31T23:59:58.123Z');
  });
  it('handles offsets', () => {
    expect(parseAisstreamTime('2026-01-01 17:00:00 +0530 IST', now).toISOString()).toBe('2026-01-01T11:30:00.000Z');
  });
  it('falls back on garbage and clamps the future', () => {
    expect(parseAisstreamTime('nope', now)).toBe(now);
    expect(parseAisstreamTime(undefined, now)).toBe(now);
    expect(parseAisstreamTime('2026-01-01 13:00:00 +0000 UTC', now)).toBe(now);
  });
});

describe('cleanText', () => {
  it('strips AIS @ padding and whitespace', () => {
    expect(cleanText('EVER GIVEN@@@@  ')).toBe('EVER GIVEN');
    expect(cleanText('@@@@')).toBeNull();
    expect(cleanText(42)).toBeNull();
  });
});

describe('normalize', () => {
  it('maps a Class A position report', () => {
    const [m] = normalize(positionReport({ mmsi: 419000001, lat: 18.9, lon: 72.8, msgId: 3, name: 'INS TEST' }));
    const p = m as PositionMsg;
    expect(p).toMatchObject({ kind: 'position', mmsi: 419000001, lat: 18.9, lon: 72.8, sog: 10, cog: 90, heading: 91, msgType: 3, nameHint: 'INS TEST' });
  });

  it('nulls AIS "not available" sentinels', () => {
    const [m] = normalize(classBReport({ mmsi: 419000002, lat: 10, lon: 75, sog: 102.3 }));
    const p = m as PositionMsg;
    expect(p.msgType).toBe(18);
    expect(p.sog).toBeNull();
    expect(p.cog).toBeNull(); // 360
    expect(p.heading).toBeNull(); // 511
  });

  it('drops invalid positions and MMSIs', () => {
    expect(normalize(positionReport({ mmsi: 419000003, lat: 91, lon: 72 }))).toEqual([]);
    expect(normalize(positionReport({ mmsi: 419000003, lat: 10, lon: 181 }))).toEqual([]);
    expect(normalize(positionReport({ mmsi: 419000003, lat: 0, lon: 0 }))).toEqual([]);
    expect(normalize(positionReport({ mmsi: 0, lat: 10, lon: 72 }))).toEqual([]);
    expect(normalize({ MessageType: 'PositionReport' })).toEqual([]);
    expect(normalize(null)).toEqual([]);
  });

  it('maps ship static data', () => {
    const [m] = normalize(shipStaticData({ mmsi: 419000004, name: 'MV KOCHI', type: 80 }));
    const s = m as StaticMsg;
    expect(s).toMatchObject({
      kind: 'static', msgType: 5, name: 'MV KOCHI', callsign: 'VTAB', imo: 9321483, shipType: 80,
      shipTypeLabel: 'Tanker', dimA: 150, dimD: 15, draught: 9.5, destination: 'MUMBAI',
    });
    expect(s.eta).toBeInstanceOf(Date);
  });

  it('ignores message types we do not store', () => {
    expect(normalize({ MessageType: 'SafetyBroadcastMessage', MetaData: { MMSI: 419000005 }, Message: { SafetyBroadcastMessage: { Text: 'hi' } } })).toEqual([]);
  });
});
