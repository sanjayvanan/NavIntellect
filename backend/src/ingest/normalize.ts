import { shipTypeLabel } from '../shared/shipTypes.js';
import type { AisMsg, PositionMsg, StaticMsg } from './types.js';

/**
 * Converts one aisstream.io envelope ({ MessageType, MetaData, Message: { [MessageType]: body } })
 * into normalized messages. Invalid / sentinel values are dropped or nulled.
 * Returns [] for messages we don't store.
 */

type Obj = Record<string, unknown>;

/** aisstream MessageType -> numeric ITU message id (used for the frontend's marker colours). */
const POSITION_TYPES: Record<string, number> = {
  PositionReport: 1, // real value (1/2/3) taken from body.MessageID
  StandardClassBPositionReport: 18,
  ExtendedClassBPositionReport: 19,
  AidsToNavigationReport: 21,
  BaseStationReport: 4,
};
const STATIC_TYPES: Record<string, number> = {
  ShipStaticData: 5,
  StaticDataReport: 24,
  ExtendedClassBPositionReport: 19,
  AidsToNavigationReport: 21,
};

export const SUBSCRIBED_MESSAGE_TYPES = [
  'PositionReport',
  'StandardClassBPositionReport',
  'ExtendedClassBPositionReport',
  'AidsToNavigationReport',
  'BaseStationReport',
  'ShipStaticData',
  'StaticDataReport',
];

export function normalize(envelope: unknown, receivedAt: Date = new Date()): AisMsg[] {
  if (!isObj(envelope)) return [];
  const type = envelope.MessageType;
  if (typeof type !== 'string') return [];
  const meta = isObj(envelope.MetaData) ? envelope.MetaData : {};
  const message = isObj(envelope.Message) ? envelope.Message : {};
  const body = isObj(message[type]) ? (message[type] as Obj) : null;
  if (!body) return [];
  if (body.Valid === false) return [];

  const mmsi = validMmsi(num(meta.MMSI) ?? num(body.UserID));
  if (mmsi == null) return [];
  const ts = parseAisstreamTime(meta.time_utc ?? meta.TimeUtc, receivedAt);
  const metaName = cleanText(meta.ShipName);
  const out: AisMsg[] = [];

  if (type in POSITION_TYPES) {
    const lat = num(body.Latitude) ?? num(meta.latitude) ?? num(meta.Latitude);
    const lon = num(body.Longitude) ?? num(meta.longitude) ?? num(meta.Longitude);
    if (lat != null && lon != null && validLat(lat) && validLon(lon) && !(lat === 0 && lon === 0)) {
      const msgId = num(body.MessageID);
      const msgType =
        type === 'PositionReport' && msgId != null && msgId >= 1 && msgId <= 3 ? msgId : POSITION_TYPES[type]!;
      const pos: PositionMsg = {
        kind: 'position',
        mmsi,
        ts,
        lat,
        lon,
        sog: range(num(body.Sog), 0, 102.2),
        cog: range(num(body.Cog), 0, 359.9),
        heading: range(int(body.TrueHeading), 0, 359),
        rot: rot(int(body.RateOfTurn)),
        navStatus: range(int(body.NavigationalStatus), 0, 15),
        msgType,
        nameHint: metaName,
      };
      out.push(pos);
    }
  }

  if (type in STATIC_TYPES) {
    const st = staticFrom(type, body, mmsi, ts);
    if (st) out.push(st);
  }

  return out;
}

function staticFrom(type: string, b: Obj, mmsi: number, ts: Date): StaticMsg | null {
  const msgType = STATIC_TYPES[type]!;
  const base = { kind: 'static' as const, mmsi, ts, msgType };
  switch (type) {
    case 'ShipStaticData': {
      const shipType = range(int(b.Type), 1, 99);
      return {
        ...base,
        name: cleanText(b.Name),
        callsign: cleanText(b.CallSign),
        imo: range(int(b.ImoNumber), 1000000, 9999999),
        shipType,
        shipTypeLabel: shipTypeLabel(shipType),
        ...dims(b.Dimension),
        draught: range(num(b.MaximumStaticDraught), 0.1, 25.5),
        destination: cleanText(b.Destination),
        eta: parseEta(b.Eta, ts),
      };
    }
    case 'StaticDataReport': {
      // Part A carries the name, part B the type/callsign/dimensions.
      const a = isObj(b.ReportA) ? b.ReportA : null;
      const rb = isObj(b.ReportB) ? b.ReportB : null;
      if (a && (a.Valid !== false) && b.PartNumber !== true) {
        return { ...base, name: cleanText(a.Name) };
      }
      if (rb && rb.Valid !== false) {
        const shipType = range(int(rb.ShipType), 1, 99);
        return {
          ...base,
          callsign: cleanText(rb.CallSign),
          shipType,
          shipTypeLabel: shipTypeLabel(shipType),
          ...dims(rb.Dimension),
        };
      }
      return null;
    }
    case 'ExtendedClassBPositionReport': {
      const shipType = range(int(b.Type), 1, 99);
      return { ...base, name: cleanText(b.Name), shipType, shipTypeLabel: shipTypeLabel(shipType), ...dims(b.Dimension) };
    }
    case 'AidsToNavigationReport': {
      const name = [cleanText(b.Name), cleanText(b.NameExtension)].filter(Boolean).join('') || null;
      return { ...base, name, shipType: null, shipTypeLabel: 'Aid to Navigation', ...dims(b.Dimension) };
    }
  }
  return null;
}

// ---------- helpers ----------

function isObj(v: unknown): v is Obj {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}
function num(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v))) return Number(v);
  return null;
}
function int(v: unknown): number | null {
  const n = num(v);
  return n == null ? null : Math.trunc(n);
}
function range(v: number | null, min: number, max: number): number | null {
  return v != null && v >= min && v <= max ? v : null;
}
function rot(v: number | null): number | null {
  // -128 = not available; valid raw ROT is -127..127
  return v != null && v >= -127 && v <= 127 ? v : null;
}
const validLat = (v: number) => v >= -90 && v <= 90;
const validLon = (v: number) => v >= -180 && v <= 180;

export function validMmsi(v: number | null): number | null {
  if (v == null || !Number.isInteger(v) || v <= 0 || v > 999_999_999) return null;
  return v;
}

/** Trims whitespace and AIS '@' padding. Returns null for empty strings. */
export function cleanText(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const s = v.replace(/@+/g, ' ').replace(/\s+/g, ' ').trim();
  return s.length ? s : null;
}

function dims(d: unknown) {
  if (!isObj(d)) return {};
  return {
    dimA: range(int(d.A), 0, 511),
    dimB: range(int(d.B), 0, 511),
    dimC: range(int(d.C), 0, 63),
    dimD: range(int(d.D), 0, 63),
  };
}

/** ETA has no year: pick the next occurrence relative to the message time. */
function parseEta(e: unknown, ref: Date): Date | null {
  if (!isObj(e)) return null;
  const month = int(e.Month), day = int(e.Day), hour = int(e.Hour) ?? 24, minute = int(e.Minute) ?? 60;
  if (!month || month > 12 || !day || day > 31) return null;
  const h = hour > 23 ? 0 : hour;
  const m = minute > 59 ? 0 : minute;
  let d = new Date(Date.UTC(ref.getUTCFullYear(), month - 1, day, h, m));
  if (d.getTime() < ref.getTime() - 30 * 86_400_000) d = new Date(Date.UTC(ref.getUTCFullYear() + 1, month - 1, day, h, m));
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * aisstream sends Go-formatted times like "2024-01-15 10:22:33.123456789 +0000 UTC".
 * Falls back to receive time if missing/unparseable, and clamps future times (clock skew).
 */
export function parseAisstreamTime(v: unknown, fallback: Date): Date {
  if (typeof v !== 'string') return fallback;
  const m = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2})(\.\d+)?\s*(Z|[+-]\d{2}:?\d{2})?/.exec(v.trim());
  if (!m) return fallback;
  const frac = m[3] ? m[3].slice(0, 4) : ''; // keep milliseconds
  let tz = m[4] ?? 'Z';
  if (/^[+-]\d{4}$/.test(tz)) tz = `${tz.slice(0, 3)}:${tz.slice(3)}`;
  const d = new Date(`${m[1]}T${m[2]}${frac}${tz}`);
  if (Number.isNaN(d.getTime())) return fallback;
  if (d.getTime() > fallback.getTime() + 60_000) return fallback;
  return d;
}
