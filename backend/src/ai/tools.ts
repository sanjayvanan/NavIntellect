import type { FunctionDeclaration } from '@google/genai';
import { cleanText, textWarning, type ActionPolicy } from './untrusted.js';

/**
 * Copilot tools. Data tools call the app's own REST endpoints as the signed-in user (same
 * validation and the same visibility rules: the model can only see what the user can see).
 * Map tools are carried out by the browser after the answer; here they are checked and recorded.
 * Results are kept small: free-tier tokens are scarce.
 * Text from outside (AIS names/destinations, zone names) is cleaned and flagged when it reads like
 * an instruction, and map actions pass the conversation's ActionPolicy (see untrusted.ts).
 */

/** GET an API path as the user. Returns status and parsed JSON. */
export type ApiGet = (path: string) => Promise<{ status: number; body: unknown }>;

/** Something the browser should do on the map. */
export type MapAction =
  | { type: 'show_ship'; mmsi: number; name: string; lat: number | null; lon: number | null }
  | { type: 'show_track'; mmsi: number; hours: number; name: string; lat: number | null; lon: number | null }
  | { type: 'show_zone'; zone_id: string; name: string }
  | { type: 'fly_to'; lat: number; lon: number; zoom: number }
  | { type: 'filter_ships'; query?: string; zone_id?: string; sort?: string };

/** A ship that appeared in tool results (lets the UI turn names in the answer into links). */
export interface ShipRef {
  mmsi: number;
  name: string;
  lat: number | null;
  lon: number | null;
}

export interface ToolContext {
  get: ApiGet;
  /** Current map view: [minLon, minLat, maxLon, maxLat]. */
  viewBbox: [number, number, number, number] | null;
  actions: MapAction[];
  ships: Map<number, ShipRef>;
  /** Limits map actions to what the user asked for (the copilot sets it; one-shot features have no actions). */
  policy?: ActionPolicy;
}

const bboxSchema = {
  type: 'array',
  items: { type: 'number' },
  minItems: 4,
  maxItems: 4,
  description: '[minLon, minLat, maxLon, maxLat] in degrees.',
};

export const TOOL_DECLARATIONS: FunctionDeclaration[] = [
  {
    name: 'search_ships',
    description:
      'Find ships heard in the last 50 hours, with the total count. Combine filters freely. ' +
      'Use area="view" for "here"/"on my screen", or a bbox you know for named seas/ports, or zone_id for a drawn zone.',
    parametersJsonSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Name, MMSI, IMO or callsign (partial names match).' },
        zone_id: { type: 'string', description: 'Only ships inside this zone (id from list_zones).' },
        area: { type: 'string', enum: ['view'], description: '"view" = only ships in the current map view.' },
        bbox: bboxSchema,
        min_speed: { type: 'number', description: 'Minimum speed in knots.' },
        max_speed: { type: 'number', description: 'Maximum speed in knots.' },
        ship_type: { type: 'string', description: 'Ship type contains this, e.g. tanker, cargo, fishing, passenger, tug.' },
        sort: { type: 'string', enum: ['recent', 'name', 'speed'], description: 'Default recent.' },
        limit: { type: 'integer', minimum: 1, maximum: 10, description: 'Ships to return (default 5). The total is always given.' },
      },
    },
  },
  {
    name: 'list_zones',
    description: "The user's zones (drawn areas) and shared preset zones: id, name, shape, kind, whether alerts are on.",
    parametersJsonSchema: { type: 'object', properties: {} },
  },
  {
    name: 'get_ship',
    description: 'Details of one ship: identity, type, destination, latest position/speed, and the zones it is in now.',
    parametersJsonSchema: { type: 'object', properties: { mmsi: { type: 'integer' } }, required: ['mmsi'] },
  },
  {
    name: 'get_track_summary',
    description: "Summary of a ship's recent movement: start/end, distance, top speed and a few timed waypoints. History is kept for about 3 days.",
    parametersJsonSchema: {
      type: 'object',
      properties: { mmsi: { type: 'integer' }, hours: { type: 'integer', minimum: 1, maximum: 72, description: 'Default 24.' } },
      required: ['mmsi'],
    },
  },
  {
    name: 'get_alerts',
    description: 'Recent zone alerts (ship entered/left a zone, loitering, speeding, AIS signal lost), newest first, with the total count.',
    parametersJsonSchema: {
      type: 'object',
      properties: {
        mmsi: { type: 'integer' },
        zone_id: { type: 'string' },
        type: { type: 'string', enum: ['zone_enter', 'zone_exit', 'loitering', 'speeding', 'ais_gap'] },
        hours: { type: 'number', minimum: 1, maximum: 168, description: 'Look back this many hours (default 24).' },
        limit: { type: 'integer', minimum: 1, maximum: 10, description: 'Default 5.' },
      },
    },
  },
  {
    name: 'show_ship',
    description: 'On the map: go to a ship and open its details. Use when the user wants to see/open/find a ship.',
    parametersJsonSchema: { type: 'object', properties: { mmsi: { type: 'integer' } }, required: ['mmsi'] },
  },
  {
    name: 'show_track',
    description: "On the map: draw a ship's track history.",
    parametersJsonSchema: {
      type: 'object',
      properties: { mmsi: { type: 'integer' }, hours: { type: 'integer', enum: [6, 24, 72], description: 'Default 24.' } },
      required: ['mmsi'],
    },
  },
  {
    name: 'show_zone',
    description: 'On the map: zoom to a zone.',
    parametersJsonSchema: { type: 'object', properties: { zone_id: { type: 'string' } }, required: ['zone_id'] },
  },
  {
    name: 'fly_to',
    description: 'On the map: move to a place (e.g. a port or strait you know the coordinates of).',
    parametersJsonSchema: {
      type: 'object',
      properties: {
        lat: { type: 'number', minimum: -85, maximum: 85 },
        lon: { type: 'number', minimum: -180, maximum: 180 },
        zoom: { type: 'integer', minimum: 3, maximum: 14, description: 'About 6 for a sea, 9 for a strait, 12 for a port.' },
      },
      required: ['lat', 'lon'],
    },
  },
  {
    name: 'filter_ship_list',
    description: 'In the app: open the Track info ship list with this search and/or zone filter, so the user can browse all results.',
    parametersJsonSchema: {
      type: 'object',
      properties: {
        query: { type: 'string' },
        zone_id: { type: 'string' },
        sort: { type: 'string', enum: ['recent', 'name', 'speed'] },
      },
    },
  },
];

// ---------- helpers ----------

type Args = Record<string, unknown>;

class ToolError extends Error {}

const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : v != null && v !== '' && Number.isFinite(Number(v)) ? Number(v) : undefined);
const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : undefined);
const round = (v: unknown, d = 1) => (num(v) === undefined ? null : Math.round(num(v)! * 10 ** d) / 10 ** d);

function ago(ms: number | null | undefined) {
  if (!ms) return null;
  const s = Math.max(0, Math.round((Date.now() - ms) / 1000));
  if (s < 90) return `${s}s ago`;
  if (s < 5400) return `${Math.round(s / 60)} min ago`;
  if (s < 172_800) return `${Math.round(s / 3600)} h ago`;
  return `${Math.round(s / 86_400)} d ago`;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function zoneIdArg(v: unknown): string | undefined {
  const id = str(v);
  if (id === undefined) return undefined;
  if (!UUID.test(id)) throw new ToolError('zone_id must be an id from list_zones (not a name).');
  return id;
}

function mmsiArg(v: unknown): number {
  const m = num(v);
  if (!m || !Number.isInteger(m) || m < 1 || m > 999_999_999) throw new ToolError('mmsi must be a ship MMSI number.');
  return m;
}

async function getJson<T>(ctx: ToolContext, path: string, what: string): Promise<T> {
  const { status, body } = await ctx.get(path);
  if (status === 404) throw new ToolError(`${what} not found.`);
  if (status >= 400) {
    const msg = (body as { error?: string })?.error;
    throw new ToolError(msg ? `${what}: ${msg}` : `${what} could not be loaded (${status}).`);
  }
  return body as T;
}

interface LegacyShip {
  mmsi: number;
  track_name: string;
  type: string;
  latitude: number | null;
  longitude: number | null;
  speed_over_ground: number;
  course_over_ground: number;
  sensor_timestamp: number | null;
  destination?: string | null;
}

const shipName = (name: unknown, mmsi: number) => cleanText(name, 40) ?? `MMSI ${mmsi}`;

function remember(ctx: ToolContext, s: { mmsi: number; name: string; lat: number | null; lon: number | null }) {
  if (ctx.ships.size < 50) ctx.ships.set(s.mmsi, { ...s, name: shipName(s.name, s.mmsi) });
}

/** Map actions go through the conversation's policy before anything is done. */
function allow(ctx: ToolContext, action: { type: MapAction['type']; mmsi?: number }) {
  const why = ctx.policy?.check(action, new Set(ctx.ships.keys()), ctx.actions.length);
  if (why) throw new ToolError(why);
}

function compactShip(ctx: ToolContext, s: LegacyShip) {
  remember(ctx, { mmsi: s.mmsi, name: s.track_name, lat: s.latitude, lon: s.longitude });
  const name = shipName(s.track_name, s.mmsi);
  const destination = cleanText(s.destination, 40);
  return {
    mmsi: s.mmsi,
    name,
    type: cleanText(s.type, 40),
    speed_kn: round(s.speed_over_ground),
    course: round(s.course_over_ground, 0),
    lat: round(s.latitude, 3),
    lon: round(s.longitude, 3),
    heard: ago(s.sensor_timestamp),
    ...(destination ? { destination } : {}),
    ...textWarning({ name, destination }),
  };
}

/** Great-circle distance in nautical miles. */
export function distanceNm(a: [number, number], b: [number, number]) {
  const R = 3440.065;
  const rad = Math.PI / 180;
  const dLat = (b[1] - a[1]) * rad;
  const dLon = (b[0] - a[0]) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a[1] * rad) * Math.cos(b[1] * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

interface TrackFeature {
  geometry: { type: 'LineString' | 'Point'; coordinates: unknown } | null;
  properties: { points: number; max_sog: number | null; times: number[] | null };
}

/** Track Feature -> a short summary the model can reason about (no raw point list). */
export function summarizeTrack(f: TrackFeature, hours: number, waypoints = 8) {
  const g = f.geometry;
  const coords: [number, number][] = !g ? [] : g.type === 'Point' ? [g.coordinates as [number, number]] : (g.coordinates as [number, number][]);
  const times = f.properties.times ?? [];
  if (!coords.length) return { hours, points: 0, note: 'No positions in this period.' };
  let dist = 0;
  for (let i = 1; i < coords.length; i++) dist += distanceNm(coords[i - 1]!, coords[i]!);
  const at = (i: number) => ({
    time: times[i] ? new Date(times[i]!).toISOString().slice(0, 16) + 'Z' : null,
    lat: round(coords[i]![1], 3),
    lon: round(coords[i]![0], 3),
  });
  const step = Math.max(1, Math.ceil((coords.length - 1) / (waypoints - 1)));
  const wp = [];
  for (let i = 0; i < coords.length; i += step) wp.push(at(i));
  if ((coords.length - 1) % step !== 0) wp.push(at(coords.length - 1));
  const first = times[0];
  const last = times[times.length - 1];
  return {
    hours,
    points: coords.length,
    start: at(0),
    end: at(coords.length - 1),
    distance_nm: round(dist, 1),
    straight_line_nm: round(distanceNm(coords[0]!, coords[coords.length - 1]!), 1),
    max_speed_kn: round(f.properties.max_sog),
    avg_speed_kn: first && last && last > first ? round(dist / ((last - first) / 3_600_000)) : null,
    waypoints: wp,
  };
}

// ---------- executors ----------

type Executor = (args: Args, ctx: ToolContext) => Promise<unknown>;

const EXECUTORS: Record<string, Executor> = {
  async search_ships(a, ctx) {
    const q = new URLSearchParams({ limit: String(Math.min(10, Math.max(1, num(a.limit) ?? 5))) });
    const query = str(a.query);
    if (query) q.set('q', query.slice(0, 64));
    const zone = zoneIdArg(a.zone_id);
    if (zone) q.set('zone_id', zone);
    const bbox = Array.isArray(a.bbox) && a.bbox.length === 4 ? a.bbox.map(Number) : a.area === 'view' ? ctx.viewBbox : null;
    if (a.area === 'view' && !ctx.viewBbox) throw new ToolError('The current map view is not known.');
    if (bbox) {
      if (bbox.some((v) => !Number.isFinite(v))) throw new ToolError('bbox must be four numbers.');
      q.set('bbox', bbox.join(','));
    }
    const min = num(a.min_speed);
    const max = num(a.max_speed);
    if (min !== undefined) q.set('min_sog', String(Math.max(0, Math.min(100, min))));
    if (max !== undefined) q.set('max_sog', String(Math.max(0, Math.min(100, max))));
    const type = str(a.ship_type);
    if (type && type.length >= 2) q.set('type', type.slice(0, 40));
    const sort = str(a.sort);
    if (sort && ['recent', 'name', 'speed'].includes(sort)) q.set('sort', sort);
    const r = await getJson<{ total: number; zone: { name: string } | null; vessels: LegacyShip[] }>(ctx, `/api/vessels/browse?${q}`, 'Ships');
    return { total: r.total, ...(r.zone ? { zone: cleanText(r.zone.name) } : {}), ships: r.vessels.map((s) => compactShip(ctx, s)) };
  },

  async list_zones(_a, ctx) {
    const r = await getJson<{ features: { id: string; properties: Record<string, unknown> }[] }>(ctx, '/api/zones', 'Zones');
    return {
      zones: r.features.map((f) => ({
        id: f.id,
        name: cleanText(f.properties.name),
        shape: f.properties.shape ?? 'polygon',
        kind: f.properties.kind,
        alerts_on: f.properties.active,
        scope: f.properties.scope,
        ...(f.properties.preset ? { preset: true } : {}),
      })),
    };
  },

  async get_ship(a, ctx) {
    const mmsi = mmsiArg(a.mmsi);
    const r = await getJson<{
      static: Record<string, unknown>;
      latest: (LegacyShip & { true_heading: number | null }) | null;
      zones: { name: string; entered_at: string }[];
    }>(ctx, `/api/vessels/${mmsi}`, 'Ship');
    const s = r.static;
    const name = shipName(s.name, mmsi);
    const callsign = cleanText(s.callsign, 20);
    const destination = cleanText(s.destination, 40);
    // AIS dimensions: dim_a + dim_b = length, dim_c + dim_d = beam (metres).
    const sum = (x: unknown, y: unknown) => (num(x) && num(y) ? num(x)! + num(y)! : null);
    remember(ctx, { mmsi, name, lat: r.latest?.latitude ?? null, lon: r.latest?.longitude ?? null });
    return {
      mmsi,
      name,
      type: cleanText(s.ship_type_label, 40),
      imo: s.imo,
      callsign,
      destination,
      eta: s.eta,
      length_m: sum(s.dim_a, s.dim_b),
      beam_m: sum(s.dim_c, s.dim_d),
      draught_m: s.draught,
      latest: r.latest
        ? {
            lat: round(r.latest.latitude, 4),
            lon: round(r.latest.longitude, 4),
            speed_kn: round(r.latest.speed_over_ground),
            course: round(r.latest.course_over_ground, 0),
            heading: round(r.latest.true_heading, 0),
            heard: ago(r.latest.sensor_timestamp),
          }
        : null,
      in_zones: r.zones.map((z) => ({ name: cleanText(z.name), since: z.entered_at })),
      ...textWarning({ name, callsign, destination }),
    };
  },

  async get_track_summary(a, ctx) {
    const mmsi = mmsiArg(a.mmsi);
    const hours = Math.min(72, Math.max(1, Math.round(num(a.hours) ?? 24)));
    const to = new Date();
    const from = new Date(to.getTime() - hours * 3_600_000);
    const q = new URLSearchParams({ from: from.toISOString(), to: to.toISOString() });
    const f = await getJson<TrackFeature>(ctx, `/api/vessels/${mmsi}/track?${q}`, 'Track');
    return { mmsi, ...summarizeTrack(f, hours) };
  },

  async get_alerts(a, ctx) {
    const limit = Math.min(10, Math.max(1, num(a.limit) ?? 5));
    const hours = Math.min(168, Math.max(1, num(a.hours) ?? 24));
    const q = new URLSearchParams({ limit: '500', since: new Date(Date.now() - hours * 3_600_000).toISOString() });
    if (a.mmsi !== undefined) q.set('mmsi', String(mmsiArg(a.mmsi)));
    const zone = zoneIdArg(a.zone_id);
    if (zone) q.set('zone_id', zone);
    const type = str(a.type);
    if (type) q.set('type', type);
    const rows = await getJson<
      { type: string; severity: string; mmsi: number; vessel_name: string | null; zone_name: string | null; created_at: string; latitude: number | null; longitude: number | null }[]
    >(ctx, `/api/alerts?${q}`, 'Alerts');
    return {
      total_in_period: rows.length >= 500 ? '500+' : rows.length,
      hours,
      alerts: rows.slice(0, limit).map((r) => {
        const name = shipName(r.vessel_name, r.mmsi);
        remember(ctx, { mmsi: r.mmsi, name, lat: r.latitude, lon: r.longitude });
        return { type: r.type, severity: r.severity, ship: name, mmsi: r.mmsi, zone: cleanText(r.zone_name), at: r.created_at, ...textWarning({ name }) };
      }),
    };
  },

  async show_ship(a, ctx) {
    const mmsi = mmsiArg(a.mmsi);
    allow(ctx, { type: 'show_ship', mmsi });
    const r = await getJson<{ static: { name?: string }; latest: LegacyShip | null }>(ctx, `/api/vessels/${mmsi}`, 'Ship');
    if (!r.latest) throw new ToolError('This ship has no known position.');
    const name = shipName(r.static.name, mmsi);
    remember(ctx, { mmsi, name, lat: r.latest.latitude, lon: r.latest.longitude });
    ctx.actions.push({ type: 'show_ship', mmsi, name, lat: r.latest.latitude, lon: r.latest.longitude });
    return { done: true, note: 'The map will open this ship.' };
  },

  async show_track(a, ctx) {
    const mmsi = mmsiArg(a.mmsi);
    const h = num(a.hours);
    const hours = h === 6 || h === 72 ? h : 24;
    allow(ctx, { type: 'show_track', mmsi });
    const r = await getJson<{ static: { name?: string }; latest: LegacyShip | null }>(ctx, `/api/vessels/${mmsi}`, 'Ship');
    if (!r.latest) throw new ToolError('This ship has no known position.');
    const name = shipName(r.static.name, mmsi);
    ctx.actions.push({ type: 'show_track', mmsi, hours, name, lat: r.latest.latitude, lon: r.latest.longitude });
    return { done: true, note: `The map will draw the last ${hours} h of the track.` };
  },

  async show_zone(a, ctx) {
    const id = zoneIdArg(a.zone_id);
    if (!id) throw new ToolError('zone_id is required.');
    allow(ctx, { type: 'show_zone' });
    const f = await getJson<{ properties: { name: string } }>(ctx, `/api/zones/${id}`, 'Zone');
    ctx.actions.push({ type: 'show_zone', zone_id: id, name: cleanText(f.properties.name) ?? 'Zone' });
    return { done: true };
  },

  async fly_to(a, ctx) {
    const lat = num(a.lat);
    const lon = num(a.lon);
    if (lat === undefined || lon === undefined || Math.abs(lat) > 85 || Math.abs(lon) > 180) throw new ToolError('lat/lon out of range.');
    const zoom = Math.min(14, Math.max(3, Math.round(num(a.zoom) ?? 8)));
    allow(ctx, { type: 'fly_to' });
    ctx.actions.push({ type: 'fly_to', lat, lon, zoom });
    return { done: true };
  },

  async filter_ship_list(a, ctx) {
    const query = str(a.query)?.slice(0, 64);
    const zone_id = zoneIdArg(a.zone_id);
    const sort = str(a.sort);
    allow(ctx, { type: 'filter_ships' });
    ctx.actions.push({ type: 'filter_ships', ...(query ? { query } : {}), ...(zone_id ? { zone_id } : {}), ...(sort ? { sort } : {}) });
    return { done: true };
  },
};

/** Runs one tool call; errors become a short message for the model (it can then try something else). */
export async function runTool(name: string, args: Args, ctx: ToolContext): Promise<Record<string, unknown>> {
  const exec = EXECUTORS[name];
  if (!exec) return { error: `Unknown tool ${name}.` };
  try {
    return { result: await exec(args ?? {}, ctx) };
  } catch (err) {
    if (err instanceof ToolError) return { error: err.message };
    throw err;
  }
}
