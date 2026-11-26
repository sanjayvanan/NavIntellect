import type { Redis } from 'ioredis';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import { hashPassword } from '../src/api/auth/password.js';
import { buildServer } from '../src/api/server.js';
import { compactTracks, pruneVessels, reindexBloated, startHeartbeat, storageGuard, tracksWatermark } from '../src/db/maintenance.js';
import { pool } from '../src/db/pool.js';
import { normalize } from '../src/ingest/normalize.js';
import { createPipeline } from '../src/ingest/pipeline.js';
import { CHANNELS, createRedis } from '../src/shared/redis.js';
import type { ModelClient } from '../src/ai/copilot.js';
import { positionReport, shipStaticData } from './fixtures/messages.js';

let app: Awaited<ReturnType<typeof buildServer>>;
let redis: Redis;
let subscriber: Redis;
let pipeline: ReturnType<typeof createPipeline>;
let adminToken = '';

/** Scripted stand-in for Gemini: each call takes the next reply from `aiScript` and records the request. */
type AiReply = Awaited<ReturnType<ModelClient['generate']>>;
let aiScript: ((req: Parameters<ModelClient['generate']>[0]) => AiReply)[] = [];
const aiCalls: Parameters<ModelClient['generate']>[0][] = [];
const fakeModel: ModelClient = {
  async generate(req) {
    aiCalls.push(structuredClone(req));
    const next = aiScript.shift();
    if (!next) throw new Error('fake model: no scripted reply left');
    return next(req);
  },
};

const ingest = async (...envelopes: unknown[]) => {
  for (const e of envelopes) pipeline.batcher.push(...normalize(e));
  await pipeline.batcher.flush();
};
const minsAgo = (m: number) => new Date(Date.now() - m * 60_000);

beforeAll(async () => {
  redis = createRedis('test');
  subscriber = createRedis('test-sub');
  pipeline = createPipeline({ redis, flushIntervalMs: 60_000, maxRows: 5000, maxBuffer: 50_000, alertCooldownMinutes: 0 });
  app = await buildServer({ redis, subscriber, aiModel: fakeModel });
  await app.ready();
  await pool.query(`INSERT INTO users (email, password_hash, role) VALUES ('admin@test.local', $1, 'admin')`, [
    await hashPassword('admin-password-123'),
  ]);
});

afterAll(async () => {
  await app.close();
  await Promise.allSettled([redis.quit(), subscriber.quit()]);
  await pool.end();
});

describe('ingestion + legacy trackList contract', () => {
  it('returns the exact shape the frontend expects, with numeric fields', async () => {
    await ingest(
      positionReport({ mmsi: 419100001, lat: 18.95, lon: 72.82, sog: 12.4, cog: 45.5, heading: 44, name: 'META NAME', time: minsAgo(5) }),
      shipStaticData({ mmsi: 419100001, name: 'MV ARABIAN STAR', type: 70 }),
      positionReport({ mmsi: 419100002, lat: 9.97, lon: 76.25, msgId: 2, time: minsAgo(2) }),
    );
    const res = await app.inject({ method: 'GET', url: '/api/ships/trackList?hours=50' });
    expect(res.statusCode).toBe(200);
    const ships = res.json() as Record<string, unknown>[];
    expect(Array.isArray(ships)).toBe(true);
    const a = ships.find((s) => s.mmsi === 419100001)!;
    expect(a).toMatchObject({
      mmsi: 419100001, track_name: 'MV ARABIAN STAR', type: 'Cargo', latitude: 18.95, longitude: 72.82,
      speed_over_ground: 12.4, course_over_ground: 45.5, true_heading: 44, message_type__id: 1,
    });
    for (const k of ['latitude', 'longitude', 'speed_over_ground', 'course_over_ground', 'true_heading', 'sensor_timestamp', 'message_type__id', 'mmsi']) {
      expect(typeof a[k], k).toBe('number');
    }
    expect(typeof a.uuid).toBe('string');
    expect(Math.abs((a.sensor_timestamp as number) - minsAgo(5).getTime())).toBeLessThan(5_000);

    const b = ships.find((s) => s.mmsi === 419100002)!;
    expect(b.track_name).toBe('MMSI 419100002'); // no name known yet
    expect(b.type).toBe('Vessel');
    expect(b.message_type__id).toBe(2);
  });

  it('keeps uuid stable and never moves a ship backward in time', async () => {
    const before = (await app.inject({ url: '/api/ships/trackList' })).json().find((s: { mmsi: number }) => s.mmsi === 419100001);
    await ingest(positionReport({ mmsi: 419100001, lat: 1, lon: 1, time: minsAgo(60) })); // stale
    const after = (await app.inject({ url: '/api/ships/trackList' })).json().find((s: { mmsi: number }) => s.mmsi === 419100001);
    expect(after.latitude).toBe(18.95);
    expect(after.uuid).toBe(before.uuid);
    // ...but the stale point is still kept in history
    const { rows } = await pool.query(`SELECT count(*)::int AS n FROM vessel_positions WHERE mmsi = 419100001`);
    expect(rows[0].n).toBe(2);
  });

  it('dedupes identical messages', async () => {
    const t = minsAgo(1);
    await ingest(positionReport({ mmsi: 419100003, lat: 13, lon: 80.3, time: t }), positionReport({ mmsi: 419100003, lat: 13, lon: 80.3, time: t }));
    const { rows } = await pool.query(`SELECT count(*)::int AS n FROM vessel_positions WHERE mmsi = 419100003`);
    expect(rows[0].n).toBe(1);
  });

  it('filters trackList by hours and bbox', async () => {
    await ingest(positionReport({ mmsi: 419100004, lat: 15, lon: 73.8, time: minsAgo(60 * 30) }));
    const recent = (await app.inject({ url: '/api/ships/trackList?hours=1' })).json() as { mmsi: number }[];
    expect(recent.some((s) => s.mmsi === 419100004)).toBe(false);
    const boxed = (await app.inject({ url: '/api/ships/trackList?hours=50&bbox=76,9,77,11' })).json() as { mmsi: number }[];
    expect(boxed.map((s) => s.mmsi)).toEqual([419100002]);
    expect((await app.inject({ url: '/api/ships/trackList?hours=abc' })).statusCode).toBe(400);
  });
});

describe('vessels and tracks', () => {
  it('searches and returns a profile', async () => {
    const list = (await app.inject({ url: '/api/vessels?q=arabian' })).json();
    expect(list[0].mmsi).toBe(419100001);
    const v = (await app.inject({ url: '/api/vessels/419100001' })).json();
    expect(v.static.name).toBe('MV ARABIAN STAR');
    expect(v.static.destination).toBe('MUMBAI');
    expect(v.latest.latitude).toBe(18.95);
    expect((await app.inject({ url: '/api/vessels/999999998' })).statusCode).toBe(404);
  });

  it('ranks search results and finds vessels without a position', async () => {
    await ingest(shipStaticData({ mmsi: 419100030, name: 'NOPOS TESTER' }));
    const exact = (await app.inject({ url: '/api/vessels?q=419100001' })).json();
    expect(exact[0].mmsi).toBe(419100001);
    expect(exact[0]).toMatchObject({ track_name: 'MV ARABIAN STAR', latitude: 18.95 });
    const prefix = (await app.inject({ url: '/api/vessels?q=4191000&limit=100' })).json() as { mmsi: number }[];
    expect(prefix.length).toBeGreaterThan(3);
    expect(prefix.every((r) => String(r.mmsi).startsWith('4191000'))).toBe(true);
    const twoChars = (await app.inject({ url: '/api/vessels?q=MV' })).json() as { track_name: string }[];
    expect(twoChars.some((r) => r.track_name === 'MV ARABIAN STAR')).toBe(true);
    const nopos = (await app.inject({ url: '/api/vessels?q=nopos' })).json();
    expect(nopos).toHaveLength(1);
    expect(nopos[0]).toMatchObject({ mmsi: 419100030, track_name: 'NOPOS TESTER', latitude: null });
    expect((await app.inject({ url: '/api/vessels?q=%25' })).json()).toEqual([]); // '%' is literal, not a wildcard
  });

  it('returns a GeoJSON LineString track with times (raw tail)', async () => {
    const pts = [0, 1, 2, 3].map((i) => positionReport({ mmsi: 419100010, lat: 19 + i * 0.01, lon: 72.5 + i * 0.01, time: minsAgo(40 - i * 10) }));
    await ingest(...pts);
    const track = (await app.inject({ url: '/api/vessels/419100010/track?from=' + minsAgo(120).toISOString() })).json();
    expect(track.type).toBe('Feature');
    expect(track.geometry.type).toBe('LineString');
    expect(track.geometry.coordinates).toHaveLength(4);
    expect(track.properties.times).toHaveLength(4);
  });

  it('packs closed hours into compact tracks losslessly and keeps serving them', async () => {
    const mmsi = 419100020;
    const times = [300, 290, 250, 200, 185].map(minsAgo); // spans several closed hours
    await ingest(
      ...times.map((t, i) => positionReport({ mmsi, lat: 20.123456 + i * 0.01, lon: 70.654321 + i * 0.01, sog: 12.3, cog: 45.6, heading: 44, time: t })),
      positionReport({ mmsi, lat: 20.5, lon: 71, sog: 102.3, cog: 360, heading: 511, time: minsAgo(170) }), // "not available" values
    );
    const raw = (
      await pool.query(
        `SELECT ts, ST_Y(geom::geometry) lat, ST_X(geom::geometry) lon, sog, cog, heading FROM vessel_positions WHERE mmsi = $1 ORDER BY ts`,
        [mmsi],
      )
    ).rows;
    expect(raw).toHaveLength(6);

    expect(await compactTracks()).toBeGreaterThanOrEqual(6);
    expect(await compactTracks()).toBe(0); // each hour is packed exactly once
    const wm = (await tracksWatermark())!;
    expect(wm.getTime()).toBeGreaterThan(raw[5].ts.getTime());

    const packed = (
      await pool.query(`SELECT p.* FROM vessel_tracks t, track_points(t.pts, t.block_start) p WHERE t.mmsi = $1 ORDER BY p.ts`, [mmsi])
    ).rows;
    expect(packed).toHaveLength(6);
    packed.forEach((p, i) => {
      const r = raw[i];
      expect(Math.abs(p.ts.getTime() - r.ts.getTime())).toBeLessThan(1000);
      expect(p.lat).toBeCloseTo(r.lat, 6);
      expect(p.lon).toBeCloseTo(r.lon, 6);
      if (r.sog == null) expect(p.sog).toBeNull();
      else expect(p.sog).toBeCloseTo(r.sog, 1);
      if (r.cog == null) expect(p.cog).toBeNull();
      else expect(p.cog).toBeCloseTo(r.cog, 1);
      expect(p.heading).toBe(r.heading);
    });

    // A fresh raw point after the watermark: the API merges packed + raw without duplicates.
    await ingest(positionReport({ mmsi, lat: 20.6, lon: 71.1, time: minsAgo(1) }));
    const track = (await app.inject({ url: `/api/vessels/${mmsi}/track?from=${minsAgo(360).toISOString()}` })).json();
    expect(track.properties.points).toBe(7);
    expect(track.geometry.coordinates[0]).toEqual([70.654321, 20.123456]);
    expect(track.properties.times).toHaveLength(7);

    // Simplified (Douglas–Peucker): fewer or equal points, each still with its time; same ends.
    const simple = (await app.inject({ url: `/api/vessels/${mmsi}/track?tolerance=0.0004&from=${minsAgo(360).toISOString()}` })).json();
    expect(simple.properties).toMatchObject({ resolution: 'simplified', points: 7, tolerance: 0.0004 });
    expect(simple.properties.returned).toBeLessThanOrEqual(7);
    expect(simple.properties.times).toHaveLength(simple.geometry.coordinates.length);
    expect(Array.isArray(simple.properties.breaks)).toBe(true);
    expect(simple.geometry.coordinates[0]).toEqual(track.geometry.coordinates[0]);
    expect(simple.geometry.coordinates.at(-1)).toEqual(track.geometry.coordinates.at(-1));

    // Area query hits packed and raw data, and misses elsewhere.
    const area = (await app.inject({ url: `/api/tracks/area?bbox=70.5,20,71.2,20.7&from=${minsAgo(360).toISOString()}` })).json();
    expect(area.vessels.find((v: { mmsi: number }) => v.mmsi === mmsi)).toMatchObject({ points: 7 });
    const elsewhere = (await app.inject({ url: `/api/tracks/area?bbox=-50,-50,-49,-49&from=${minsAgo(360).toISOString()}` })).json();
    expect(elsewhere.vessels).toEqual([]);
    expect((await app.inject({ url: '/api/tracks/area?bbox=170,0,-170,10' })).statusCode).toBe(400);
  });

  it('forgets ships not heard for a long time, but never one still on the map', async () => {
    await pool.query(`DELETE FROM vessels WHERE mmsi IN (419900001, 419900002, 419900003)`);
    await pool.query(
      `INSERT INTO vessels (mmsi, name, first_seen, last_seen) VALUES
         (419900001, 'OLD GONE', now() - interval '60 days', now() - interval '40 days'),
         (419900002, 'OLD ON MAP', now() - interval '60 days', now() - interval '40 days'),
         (419900003, 'RECENT', now() - interval '2 days', now() - interval '1 day')`,
    );
    await pool.query(
      `INSERT INTO vessel_latest (mmsi, ts, lat, lon, geom, msg_type) VALUES (419900002, now() - interval '1 day', 1, 1, ST_SetSRID(ST_MakePoint(1, 1), 4326)::geography, 1)
       ON CONFLICT (mmsi) DO NOTHING`,
    );
    expect(await pruneVessels(30)).toBeGreaterThanOrEqual(1);
    const { rows } = await pool.query(`SELECT mmsi FROM vessels WHERE mmsi IN (419900001, 419900002, 419900003) ORDER BY mmsi`);
    expect(rows.map((r) => r.mmsi)).toEqual([419900002, 419900003]);
    await pool.query(`DELETE FROM vessels WHERE mmsi IN (419900002, 419900003)`); // cascades to vessel_latest
  });

  it('writes a database heartbeat (Supabase free-plan keep-alive)', async () => {
    await pool.query(`DELETE FROM job_state WHERE name = 'heartbeat:test'`);
    const stop = startHeartbeat('test');
    await new Promise((r) => setTimeout(r, 300));
    stop();
    const { rows } = await pool.query(`SELECT value FROM job_state WHERE name = 'heartbeat:test'`);
    expect(Date.now() - new Date(rows[0].value).getTime()).toBeLessThan(60_000);
  });

  it('rebuilds bloated live-position indexes, and leaves normal ones alone', async () => {
    expect(await reindexBloated()).toEqual([]); // small test table: nothing to do
    // Thresholds at zero: every hot index counts as bloated and is rebuilt, still valid afterwards.
    expect((await reindexBloated({ ratio: 0, minMb: 0 })).sort()).toEqual(['vessel_latest_geom', 'vessel_latest_pkey', 'vessel_latest_ts']);
    const { rows } = await pool.query(
      `SELECT count(*)::int AS n FROM pg_index x JOIN pg_class i ON i.oid = x.indexrelid
       WHERE x.indrelid = 'vessel_latest'::regclass AND x.indisvalid`,
    );
    expect(rows[0].n).toBeGreaterThanOrEqual(3);
  });

  it('storage guard drops the oldest track day but never the last one', async () => {
    await pool.query(
      `INSERT INTO vessel_tracks (mmsi, block_start, n, min_lat, min_lon, max_lat, max_lon, pts)
       VALUES (419100021, date_trunc('day', now(), 'UTC') - interval '1 day', 1, 1, 1, 1, 1, decode('00', 'hex'))`,
    );
    const past = `SELECT count(*)::int n FROM track_partitions() WHERE day < date_trunc('day', now(), 'UTC')`;
    const before = (await pool.query(past)).rows[0].n;
    expect(before).toBeGreaterThanOrEqual(1);
    expect(await storageGuard(1)).toBe(before); // 1 MB limit: always "over"
    expect((await pool.query(past)).rows[0].n).toBe(0);
    expect((await pool.query(`SELECT count(*)::int n FROM vessel_tracks WHERE mmsi = 419100020`)).rows[0].n).toBeGreaterThan(0);
  });
});

describe('auth', () => {
  it('rejects writes without a token', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/zones', payload: {} });
    expect(res.statusCode).toBe(401);
  });

  it('logs in, rotates refresh tokens and detects reuse', async () => {
    const bad = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: 'admin@test.local', password: 'wrong' } });
    expect(bad.statusCode).toBe(401);

    const login = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: 'admin@test.local', password: 'admin-password-123' } });
    expect(login.statusCode).toBe(200);
    const { access_token, refresh_token } = login.json();
    adminToken = access_token;

    const me = await app.inject({ url: '/api/auth/me', headers: { authorization: `Bearer ${access_token}` } });
    expect(me.json()).toMatchObject({ email: 'admin@test.local', role: 'admin' });

    const r1 = await app.inject({ method: 'POST', url: '/api/auth/refresh', payload: { refresh_token } });
    expect(r1.statusCode).toBe(200);
    const rotated = r1.json().refresh_token;
    expect(rotated).not.toBe(refresh_token);

    // Replaying the old token revokes every session, including the rotated one.
    expect((await app.inject({ method: 'POST', url: '/api/auth/refresh', payload: { refresh_token } })).statusCode).toBe(401);
    expect((await app.inject({ method: 'POST', url: '/api/auth/refresh', payload: { refresh_token: rotated } })).statusCode).toBe(401);
  });

  it('enforces roles', async () => {
    const created = await app.inject({
      method: 'POST', url: '/api/users', headers: { authorization: `Bearer ${adminToken}` },
      payload: { email: 'viewer@test.local', password: 'viewer-password-1', role: 'viewer' },
    });
    expect(created.statusCode).toBe(201);
    const login = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: 'viewer@test.local', password: 'viewer-password-1' } });
    const viewerToken = login.json().access_token;
    const geometry = { type: 'Polygon', coordinates: [[[10, 10], [10.1, 10], [10.1, 10.1], [10, 10]]] };
    const shared = await app.inject({ method: 'POST', url: '/api/zones', headers: { authorization: `Bearer ${viewerToken}` }, payload: { name: 's', geometry, scope: 'shared' } });
    expect(shared.statusCode).toBe(403);
    const mine = await app.inject({ method: 'POST', url: '/api/zones', headers: { authorization: `Bearer ${viewerToken}` }, payload: { name: 'mine', geometry } });
    expect(mine.statusCode).toBe(201);
    expect(mine.json().properties).toMatchObject({ scope: 'personal', active: false, shape: 'polygon', shape_meta: {} });

    // Shape is recorded on create and can change with a redraw (shape and its figures together).
    const auth = { authorization: `Bearer ${viewerToken}` };
    const circle = await app.inject({
      method: 'POST', url: '/api/zones', headers: auth,
      payload: { name: 'c', geometry, shape: 'circle', shape_meta: { radius_nm: 3.2, center: [10.05, 10.03] } },
    });
    expect(circle.json().properties).toMatchObject({ shape: 'circle', shape_meta: { radius_nm: 3.2, center: [10.05, 10.03] } });
    const id = circle.json().id;
    const redrawn = await app.inject({
      method: 'PATCH', url: `/api/zones/${id}`, headers: auth,
      payload: { geometry, shape: 'rectangle', shape_meta: { width_nm: 6, height_nm: 6 } },
    });
    expect(redrawn.json().properties).toMatchObject({ shape: 'rectangle', shape_meta: { width_nm: 6, height_nm: 6 } });
    // Partial edits change only what they send (no defaults filled in for omitted fields).
    await app.inject({ method: 'PATCH', url: `/api/zones/${id}`, headers: auth, payload: { kind: 'port', rules: { max_speed: 5 } } });
    const toggled = await app.inject({ method: 'PATCH', url: `/api/zones/${id}`, headers: auth, payload: { active: true } });
    expect(toggled.json().properties).toMatchObject({ active: true, kind: 'port', rules: { max_speed: 5 }, shape: 'rectangle', shape_meta: { width_nm: 6 } });
    const half = await app.inject({ method: 'PATCH', url: `/api/zones/${id}`, headers: auth, payload: { shape: 'polygon' } });
    expect(half.statusCode).toBe(400);
    const bad = await app.inject({ method: 'POST', url: '/api/zones', headers: auth, payload: { name: 'x', geometry, shape: 'hexagon' } });
    expect(bad.statusCode).toBe(400);
  });
});

describe('registration and preferences', () => {
  it('registers a viewer, rejects duplicates and ignores a requested role', async () => {
    const res = await app.inject({
      method: 'POST', url: '/api/auth/register',
      payload: { email: 'new@test.local', password: 'new-user-password', name: 'New User', role: 'admin' },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().user).toMatchObject({ email: 'new@test.local', role: 'viewer', name: 'New User' });
    expect(res.json().access_token).toBeTruthy();

    const dup = await app.inject({ method: 'POST', url: '/api/auth/register', payload: { email: 'NEW@test.local', password: 'another-password' } });
    expect(dup.statusCode).toBe(409);
    const short = await app.inject({ method: 'POST', url: '/api/auth/register', payload: { email: 'x@test.local', password: 'short' } });
    expect(short.statusCode).toBe(400);
  });

  it('stores, returns and clears per-user settings', async () => {
    const login = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: 'new@test.local', password: 'new-user-password' } });
    const auth = { authorization: `Bearer ${login.json().access_token}` };
    expect((await app.inject({ url: '/api/me/preferences' })).statusCode).toBe(401);
    expect((await app.inject({ url: '/api/me/preferences', headers: auth })).json().settings).toEqual({});

    const settings = { mode: 'dark', view: { lat: 18.9, lng: 72.8, zoom: 9 }, baseLayer: 'Satellite', overlays: ['Sea marks'], shipSize: 'large' };
    const put = await app.inject({ method: 'PUT', url: '/api/me/preferences', headers: auth, payload: { settings } });
    expect(put.statusCode).toBe(200);
    expect((await app.inject({ url: '/api/me/preferences', headers: auth })).json().settings).toEqual(settings);

    const fresh = await app.inject({ method: 'PUT', url: '/api/me/preferences', headers: auth, payload: { settings: { mode: 'dark', view: null } } });
    expect(fresh.statusCode).toBe(200); // a new user who hasn't moved the map yet

    const bad = await app.inject({ method: 'PUT', url: '/api/me/preferences', headers: auth, payload: { settings: { view: { lat: 200, lng: 0, zoom: 3 } } } });
    expect(bad.statusCode).toBe(400);
    // Hiding many map objects must still fit (1,000 ids per type is the client-side cap).
    const ids = (n: number) => Array.from({ length: n }, () => crypto.randomUUID());
    const manyHidden = await app.inject({
      method: 'PUT', url: '/api/me/preferences', headers: auth,
      payload: { settings: { mode: 'dark', hidden: { zone: ids(1000), pin: ids(1000) } } },
    });
    expect(manyHidden.statusCode).toBe(200);
    const huge = await app.inject({ method: 'PUT', url: '/api/me/preferences', headers: auth, payload: { settings: { blob: 'x'.repeat(200_000) } } });
    expect(huge.statusCode).toBe(413);

    expect((await app.inject({ method: 'DELETE', url: '/api/me/preferences', headers: auth })).statusCode).toBe(204);
    expect((await app.inject({ url: '/api/me/preferences', headers: auth })).json().settings).toEqual({});
  });
});

describe('geofences and alerts', () => {
  let zoneId = '';
  // Box around Mumbai harbour approaches.
  const square = { type: 'Polygon', coordinates: [[[72.7, 18.8], [73.0, 18.8], [73.0, 19.1], [72.7, 19.1], [72.7, 18.8]]] };

  it('creates a zone from GeoJSON', async () => {
    const res = await app.inject({
      method: 'POST', url: '/api/zones', headers: { authorization: `Bearer ${adminToken}` },
      payload: { name: 'Mumbai Restricted', kind: 'restricted', geometry: square, rules: { max_speed: 8 }, scope: 'shared', active: true },
    });
    expect(res.statusCode).toBe(201);
    const f = res.json();
    zoneId = f.id;
    expect(f.geometry.type).toBe('MultiPolygon');
    expect(f.properties.kind).toBe('restricted');

    const bad = await app.inject({
      method: 'POST', url: '/api/zones', headers: { authorization: `Bearer ${adminToken}` },
      payload: { name: 'x', geometry: { type: 'Point', coordinates: [1, 2] } },
    });
    expect(bad.statusCode).toBe(400);
  });

  it('raises enter, speeding and exit alerts and pushes them over Redis', async () => {
    const received: { type: string }[] = [];
    const sub = createRedis('test-alerts');
    await sub.subscribe(CHANNELS.alerts);
    sub.on('message', (_c, p) => received.push(...JSON.parse(p)));

    await ingest(positionReport({ mmsi: 419200001, lat: 18.5, lon: 72.85, sog: 12, time: minsAgo(3) })); // outside
    await ingest(positionReport({ mmsi: 419200001, lat: 18.9, lon: 72.85, sog: 12, time: minsAgo(2) })); // inside, fast
    let alerts = (await app.inject({ url: `/api/alerts?mmsi=419200001` })).json() as { type: string; severity: string; zone_name: string }[];
    expect(alerts.map((a) => a.type).sort()).toEqual(['speeding', 'zone_enter']);
    expect(alerts.find((a) => a.type === 'zone_enter')).toMatchObject({ severity: 'critical', zone_name: 'Mumbai Restricted' });

    const inside = (await app.inject({ url: `/api/zones/${zoneId}/vessels` })).json();
    // Live from latest positions, so other test vessels parked in the box count too.
    expect(inside.vessels.map((v: { mmsi: number }) => v.mmsi)).toContain(419200001);
    expect(inside.total).toBe(inside.vessels.length);

    await ingest(positionReport({ mmsi: 419200001, lat: 19.5, lon: 72.85, sog: 12, time: minsAgo(1) })); // outside again
    alerts = (await app.inject({ url: `/api/alerts?mmsi=419200001&type=zone_exit` })).json();
    expect(alerts).toHaveLength(1);

    await new Promise((r) => setTimeout(r, 200));
    expect(received.map((a) => a.type)).toEqual(expect.arrayContaining(['zone_enter', 'speeding', 'zone_exit']));
    await sub.quit();
  });

  it('acknowledges an alert and writes the audit log', async () => {
    const [alert] = (await app.inject({ url: '/api/alerts?status=open&limit=1' })).json();
    const res = await app.inject({ method: 'POST', url: `/api/alerts/${alert.id}/ack`, headers: { authorization: `Bearer ${adminToken}` }, payload: { note: 'checked' } });
    expect(res.statusCode).toBe(200);
    expect(res.json().acknowledged_by_email).toBe('admin@test.local');
    const audit = (await app.inject({ url: '/api/audit', headers: { authorization: `Bearer ${adminToken}` } })).json();
    expect(audit.map((a: { action: string }) => a.action)).toEqual(expect.arrayContaining(['alert.ack', 'zone.create']));
  });

  it('detects loitering after loiter_minutes of near-zero speed', async () => {
    const box = { type: 'Polygon', coordinates: [[[80.2, 13.0], [80.4, 13.0], [80.4, 13.2], [80.2, 13.2], [80.2, 13.0]]] };
    const res = await app.inject({
      method: 'POST', url: '/api/zones', headers: { authorization: `Bearer ${adminToken}` },
      payload: { name: 'Chennai Anchorage', kind: 'anchorage', geometry: box, rules: { loiter_minutes: 20, alert_on_enter: false }, scope: 'shared', active: true },
    });
    expect(res.statusCode).toBe(201);
    await ingest(positionReport({ mmsi: 419200003, lat: 13.1, lon: 80.3, sog: 0.2, time: minsAgo(30) }));
    await ingest(positionReport({ mmsi: 419200003, lat: 13.1, lon: 80.3, sog: 0.1, time: minsAgo(15) }));
    expect((await app.inject({ url: '/api/alerts?mmsi=419200003' })).json()).toHaveLength(0); // 15 min < 20
    await ingest(positionReport({ mmsi: 419200003, lat: 13.1, lon: 80.3, sog: 0.3, time: minsAgo(5) }));
    const alerts = (await app.inject({ url: '/api/alerts?mmsi=419200003' })).json();
    expect(alerts.map((a: { type: string }) => a.type)).toEqual(['loitering']);
    expect(alerts[0].severity).toBe('warning');
  });

  it('detects AIS gaps for vessels inside zones', async () => {
    await ingest(positionReport({ mmsi: 419200002, lat: 18.95, lon: 72.9, sog: 3, time: minsAgo(45) }));
    await pipeline.sweepGaps(30);
    const alerts = (await app.inject({ url: '/api/alerts?mmsi=419200002&type=ais_gap' })).json();
    expect(alerts).toHaveLength(1);
  });

  it('lists ships with a total, searches them and filters to those inside a zone', async () => {
    const box = { type: 'Polygon', coordinates: [[[55.0, -21.0], [55.3, -21.0], [55.3, -20.7], [55.0, -20.7], [55.0, -21.0]]] };
    const created = await app.inject({
      method: 'POST', url: '/api/zones', headers: { authorization: `Bearer ${adminToken}` },
      payload: { name: 'Reunion Box', geometry: box, scope: 'shared' },
    });
    const zoneId = created.json().id as string;
    await ingest(
      shipStaticData({ mmsi: 419500001, name: 'BROWSE ALPHA' }),
      shipStaticData({ mmsi: 419500002, name: 'BROWSE BRAVO' }),
      shipStaticData({ mmsi: 419500003, name: 'BROWSE CHARLIE' }),
      positionReport({ mmsi: 419500001, lat: -20.9, lon: 55.1, sog: 4 }), // inside
      positionReport({ mmsi: 419500002, lat: -20.8, lon: 55.2, sog: 9 }), // inside
      positionReport({ mmsi: 419500003, lat: -19.0, lon: 57.5, sog: 1 }), // outside
    );
    type Page = { total: number; zone: { name: string } | null; vessels: { mmsi: number; track_name: string }[] };
    const browse = async (qs: string) => (await app.inject({ url: `/api/vessels/browse?${qs}` })).json() as Page;

    const all = await browse('limit=200');
    expect(all.total).toBeGreaterThanOrEqual(3);
    expect(all.vessels.length).toBe(Math.min(all.total, 200));

    const inZone = await browse(`zone_id=${zoneId}&sort=speed`);
    expect(inZone).toMatchObject({ total: 2, zone: { name: 'Reunion Box' } });
    expect(inZone.vessels.map((v) => v.mmsi)).toEqual([419500002, 419500001]); // fastest first

    const searched = await browse('q=browse&sort=name&limit=2');
    expect(searched.total).toBe(3);
    expect(searched.vessels.map((v) => v.track_name)).toEqual(['BROWSE ALPHA', 'BROWSE BRAVO']);
    expect((await browse('q=browse&sort=name&limit=2&offset=2')).vessels.map((v) => v.track_name)).toEqual(['BROWSE CHARLIE']);
    expect((await browse(`q=charlie&zone_id=${zoneId}`)).total).toBe(0);

    // Someone else's personal zone cannot be used as a filter.
    const owner = (await app.inject({
      method: 'POST', url: '/api/auth/register', remoteAddress: '10.9.9.8', payload: { email: 'browse-owner@test.local', password: 'browse-owner-pass' },
    })).json().access_token as string;
    const personal = await app.inject({
      method: 'POST', url: '/api/zones', headers: { authorization: `Bearer ${owner}` }, payload: { name: 'Private Box', geometry: box },
    });
    expect((await app.inject({ url: `/api/vessels/browse?zone_id=${personal.json().id}` })).statusCode).toBe(404);
    const mine = await app.inject({ url: `/api/vessels/browse?zone_id=${personal.json().id}`, headers: { authorization: `Bearer ${owner}` } });
    expect(mine.json().total).toBe(2);
  });
});

describe('personal zones and presets', () => {
  const geometry = { type: 'Polygon', coordinates: [[[60.0, 15.0], [60.3, 15.0], [60.3, 15.3], [60.0, 15.3], [60.0, 15.0]]] };
  const signup = async (email: string) =>
    (await app.inject({ method: 'POST', url: '/api/auth/register', payload: { email, password: 'personal-zone-pass' } })).json().access_token as string;

  it('ships the well-known presets as shared zones with monitoring off', async () => {
    const all = (await app.inject({ url: '/api/zones?scope=shared' })).json().features as { properties: Record<string, unknown> }[];
    const presets = all.filter((f) => f.properties.preset);
    expect(presets.length).toBeGreaterThanOrEqual(10);
    expect(presets.map((f) => f.properties.name)).toContain('Strait of Hormuz');
    expect(presets.every((f) => f.properties.active === false && f.properties.scope === 'shared')).toBe(true);
    expect(Number(presets[0]!.properties.area_nm2)).toBeGreaterThan(0);
    const byName = Object.fromEntries(presets.map((f) => [f.properties.name, f.properties]));
    expect(byName['Panama Canal']).toMatchObject({ shape: 'rectangle' });
    expect(Number((byName['Panama Canal']!.shape_meta as { width_nm: number }).width_nm)).toBeGreaterThan(25);
    expect(byName['Strait of Hormuz']).toMatchObject({ shape: 'polygon', shape_meta: { corners: 8 } });
  });

  it('keeps a personal zone, its vessels and its alerts private to the owner', async () => {
    const alice = { authorization: `Bearer ${await signup('alice@test.local')}` };
    const bob = { authorization: `Bearer ${await signup('bob@test.local')}` };
    const created = await app.inject({
      method: 'POST', url: '/api/zones', headers: alice,
      payload: { name: 'Alice Box', geometry, color: '#ff8800', active: true, rules: { alert_on_exit: false } },
    });
    expect(created.statusCode).toBe(201);
    const id = created.json().id as string;
    expect(created.json().properties).toMatchObject({ scope: 'personal', color: '#ff8800', active: true });

    const names = async (h?: Record<string, string>) =>
      ((await app.inject({ url: '/api/zones', headers: h })).json().features as { properties: { name: string } }[]).map((f) => f.properties.name);
    expect(await names(alice)).toContain('Alice Box');
    expect(await names(bob)).not.toContain('Alice Box');
    expect(await names()).not.toContain('Alice Box');

    for (const h of [bob, undefined]) {
      expect((await app.inject({ url: `/api/zones/${id}`, headers: h })).statusCode).toBe(404);
      expect((await app.inject({ url: `/api/zones/${id}/vessels`, headers: h })).statusCode).toBe(404);
    }
    expect((await app.inject({ method: 'PATCH', url: `/api/zones/${id}`, headers: bob, payload: { name: 'x' } })).statusCode).toBe(404);
    expect((await app.inject({ method: 'DELETE', url: `/api/zones/${id}`, headers: bob })).statusCode).toBe(404);

    // A vessel entering Alice's zone raises an alert only Alice can see.
    await ingest(positionReport({ mmsi: 419400001, lat: 15.1, lon: 60.1, sog: 9, time: minsAgo(1) }));
    const alertsFor = async (h?: Record<string, string>) => (await app.inject({ url: '/api/alerts?mmsi=419400001', headers: h })).json() as unknown[];
    expect(await alertsFor(alice)).toHaveLength(1);
    expect(await alertsFor(bob)).toHaveLength(0);
    expect(await alertsFor()).toHaveLength(0);
    const zonesOf = async (h?: Record<string, string>) => (await app.inject({ url: '/api/vessels/419400001', headers: h })).json().zones as unknown[];
    expect(await zonesOf(alice)).toHaveLength(1);
    expect(await zonesOf(bob)).toHaveLength(0);
    expect((await app.inject({ url: `/api/zones/${id}/vessels`, headers: alice })).json().total).toBe(1);

    // Owner can edit and delete; a viewer cannot edit shared presets.
    const patched = await app.inject({ method: 'PATCH', url: `/api/zones/${id}`, headers: alice, payload: { name: 'Alice Renamed', active: false } });
    expect(patched.json().properties).toMatchObject({ name: 'Alice Renamed', active: false });
    const preset = ((await app.inject({ url: '/api/zones?scope=shared' })).json().features as { id: string }[])[0]!;
    expect((await app.inject({ method: 'PATCH', url: `/api/zones/${preset.id}`, headers: alice, payload: { active: true } })).statusCode).toBe(403);
    expect((await app.inject({ method: 'DELETE', url: `/api/zones/${id}`, headers: alice })).statusCode).toBe(204);
  });
});

describe('annotations (pins)', () => {
  const pin = (lng: number, lat: number, extra: Record<string, unknown> = {}) => ({
    kind: 'pin', name: 'Buoy', geometry: { type: 'Point', coordinates: [lng, lat] }, style: { color: '#ff0000', icon: 'anchor' }, ...extra,
  });
  const signup = async (email: string) => ({
    authorization: `Bearer ${(await app.inject({ method: 'POST', url: '/api/auth/register', payload: { email, password: 'pin-test-password' } })).json().access_token}`,
  });

  it('creates, lists, moves, edits and deletes a personal pin', async () => {
    const carol = await signup('carol@test.local');
    const created = await app.inject({ method: 'POST', url: '/api/annotations', headers: carol, payload: pin(72.8, 18.9, { description: 'Harbour entrance' }) });
    expect(created.statusCode).toBe(201);
    const f = created.json();
    expect(f.geometry).toEqual({ type: 'Point', coordinates: [72.8, 18.9] });
    expect(f.properties).toMatchObject({ kind: 'pin', name: 'Buoy', scope: 'personal', style: { color: '#ff0000', icon: 'anchor' } });

    const list = (await app.inject({ url: '/api/annotations?kind=pin', headers: carol })).json().features;
    expect(list.map((x: { id: string }) => x.id)).toContain(f.id);
    expect((await app.inject({ url: '/api/annotations?bbox=72,18,73,19', headers: carol })).json().features).toHaveLength(1);
    expect((await app.inject({ url: '/api/annotations?bbox=10,10,11,11', headers: carol })).json().features).toHaveLength(0);
    // bbox crossing the antimeridian (minLon > maxLon) still finds pins on the near side
    expect((await app.inject({ url: '/api/annotations?bbox=170,18,73,19', headers: carol })).json().features).toHaveLength(1);

    const moved = await app.inject({
      method: 'PATCH', url: `/api/annotations/${f.id}`, headers: carol,
      payload: { geometry: { type: 'Point', coordinates: [72.85, 18.95] }, name: 'Fairway buoy', style: { color: '#00ff00', icon: 'flag' } },
    });
    expect(moved.statusCode).toBe(200);
    expect(moved.json()).toMatchObject({
      geometry: { coordinates: [72.85, 18.95] },
      properties: { name: 'Fairway buoy', description: 'Harbour entrance', style: { icon: 'flag' } },
    });

    expect((await app.inject({ method: 'DELETE', url: `/api/annotations/${f.id}`, headers: carol })).statusCode).toBe(204);
    expect((await app.inject({ url: `/api/annotations/${f.id}`, headers: carol })).statusCode).toBe(404);
  });

  it('keeps personal pins private and shared pins operator-only', async () => {
    const dave = await signup('dave@test.local');
    const erin = await signup('erin@test.local');
    const id = (await app.inject({ method: 'POST', url: '/api/annotations', headers: dave, payload: pin(1, 2) })).json().id;
    for (const h of [erin, undefined]) {
      expect((await app.inject({ url: `/api/annotations/${id}`, headers: h })).statusCode).toBe(404);
      expect((await app.inject({ url: '/api/annotations', headers: h })).json().features.map((x: { id: string }) => x.id)).not.toContain(id);
    }
    expect((await app.inject({ method: 'PATCH', url: `/api/annotations/${id}`, headers: erin, payload: { name: 'x' } })).statusCode).toBe(404);
    expect((await app.inject({ method: 'DELETE', url: `/api/annotations/${id}`, headers: erin })).statusCode).toBe(404);

    expect((await app.inject({ method: 'POST', url: '/api/annotations', headers: dave, payload: pin(1, 2, { scope: 'shared' }) })).statusCode).toBe(403);
    const admin = { authorization: `Bearer ${adminToken}` };
    const shared = await app.inject({ method: 'POST', url: '/api/annotations', headers: admin, payload: pin(3, 4, { scope: 'shared' }) });
    expect(shared.statusCode).toBe(201);
    expect((await app.inject({ url: `/api/annotations/${shared.json().id}` })).statusCode).toBe(200); // anyone can see it
    expect((await app.inject({ method: 'PATCH', url: `/api/annotations/${shared.json().id}`, headers: dave, payload: { name: 'x' } })).statusCode).toBe(403);
  });

  it('validates geometry and style per kind', async () => {
    const frank = await signup('frank@test.local');
    const status = async (payload: Record<string, unknown>) => (await app.inject({ method: 'POST', url: '/api/annotations', headers: frank, payload })).statusCode;
    expect(await status(pin(200, 10))).toBe(400); // longitude out of range
    expect(await status({ ...pin(1, 1), geometry: { type: 'LineString', coordinates: [[0, 0], [1, 1]] } })).toBe(400); // pins are points
    expect(await status({ ...pin(1, 1), style: { icon: 'unicorn' } })).toBe(400);
    expect(await status({ ...pin(1, 1), kind: 'route' })).toBe(400); // unknown kind
    expect(await status({ ...pin(1, 1), name: '' })).toBe(400);
    const defaults = await app.inject({
      method: 'POST', url: '/api/annotations', headers: frank,
      payload: { kind: 'pin', name: 'Plain', geometry: { type: 'Point', coordinates: [5, 5] } },
    });
    expect(defaults.json().properties.style).toEqual({ color: '#16c5d8', icon: 'pin' });
  });
});

describe('websocket', () => {
  it('pushes live vessel updates filtered by bbox', async () => {
    await app.listen({ port: 0, host: '127.0.0.1' });
    const port = (app.server.address() as { port: number }).port;
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
    const messages: { type: string; data?: { mmsi: number }[] }[] = [];
    ws.on('message', (m) => messages.push(JSON.parse(m.toString())));
    await new Promise((r) => ws.once('open', r));
    ws.send(JSON.stringify({ subscribe: { bbox: [80, 12, 81, 14] } }));
    await new Promise((r) => setTimeout(r, 100));

    await ingest(
      positionReport({ mmsi: 419300001, lat: 13.1, lon: 80.3 }), // inside bbox (Chennai)
      positionReport({ mmsi: 419300002, lat: 18.9, lon: 72.8 }), // outside
    );
    await new Promise((r) => setTimeout(r, 1500));
    ws.close();

    const pushed = messages.filter((m) => m.type === 'vessels').flatMap((m) => m.data!.map((s) => s.mmsi));
    expect(messages[0]!.type).toBe('hello');
    expect(pushed).toContain(419300001);
    expect(pushed).not.toContain(419300002);
  });

  it('pushes a personal-zone alert only to the zone owner', async () => {
    const port = (app.server.address() as { port: number }).port; // listening since the previous test
    const signup = async (email: string) =>
      // Own client address: the sign-up rate limit (10/min per IP) is shared with earlier tests.
      (await app.inject({ method: 'POST', url: '/api/auth/register', remoteAddress: '10.9.9.9', payload: { email, password: 'ws-alert-pass-123' } })).json().access_token as string;
    const carol = await signup('ws-owner@test.local');
    const dave = await signup('ws-other@test.local');
    const geometry = { type: 'Polygon', coordinates: [[[62.0, 16.0], [62.3, 16.0], [62.3, 16.3], [62.0, 16.3], [62.0, 16.0]]] };
    const created = await app.inject({
      method: 'POST', url: '/api/zones', headers: { authorization: `Bearer ${carol}` },
      payload: { name: 'Carol Box', geometry, active: true },
    });
    expect(created.statusCode).toBe(201);

    const open = async (token?: string) => {
      const ws = new WebSocket(`ws://127.0.0.1:${port}/ws${token ? `?token=${token}` : ''}`);
      const alerts: { mmsi: number; type: string; zone_name: string }[] = [];
      ws.on('message', (m) => {
        const msg = JSON.parse(m.toString());
        if (msg.type === 'alert') alerts.push(msg.data);
      });
      await new Promise((r) => ws.once('open', r));
      return { ws, alerts };
    };
    const [owner, other, anon] = await Promise.all([open(carol), open(dave), open()]);
    await new Promise((r) => setTimeout(r, 100));

    await ingest(positionReport({ mmsi: 419300010, lat: 16.1, lon: 62.1, sog: 5, time: minsAgo(1) }));
    await new Promise((r) => setTimeout(r, 300));
    for (const c of [owner, other, anon]) c.ws.close();

    const mine = (c: typeof owner) => c.alerts.filter((a) => a.mmsi === 419300010);
    expect(mine(owner)).toEqual([expect.objectContaining({ type: 'zone_enter', zone_name: 'Carol Box' })]);
    expect(mine(other)).toHaveLength(0);
    expect(mine(anon)).toHaveLength(0);
  });
});

describe('AI copilot', () => {
  let token = '';
  const auth = () => ({ authorization: `Bearer ${token}` });
  const ask = (text: string, context: Record<string, unknown> = {}) =>
    app.inject({ method: 'POST', url: '/api/ai/copilot', headers: auth(), payload: { messages: [{ role: 'user', text }], context } });
  const call = (name: string, args: Record<string, unknown>, id = name) => ({ name, args, id });
  const responsesIn = (req: { contents: { parts?: { functionResponse?: { name?: string; response?: Record<string, unknown> } }[] }[] }) =>
    req.contents.flatMap((c) => c.parts ?? []).flatMap((p) => (p.functionResponse ? [p.functionResponse] : []));

  beforeAll(async () => {
    // Budget counters live in Redis per (Pacific) day and survive between test runs.
    const keys = await redis.keys('ais_test:ai:*');
    if (keys.length) await redis.del(...keys);
    token = (await app.inject({
      method: 'POST', url: '/api/auth/register', remoteAddress: '10.9.9.7', payload: { email: 'copilot-user@test.local', password: 'copilot-user-pass' },
    })).json().access_token;
  });

  it('needs a signed-in user', async () => {
    expect((await app.inject({ url: '/api/ai/status' })).statusCode).toBe(401);
    const status = (await app.inject({ url: '/api/ai/status', headers: auth() })).json();
    expect(status).toMatchObject({ enabled: true, usage: { user_used_today: 0, user_limit_today: 10 } });
  });

  it('answers with tools run as the user and returns map actions', async () => {
    aiCalls.length = 0;
    aiScript = [
      () => ({ functionCalls: [call('search_ships', { query: 'browse', sort: 'name', limit: 2 }), call('list_zones', {})] }),
      () => ({ functionCalls: [call('show_ship', { mmsi: 419500001 }), call('get_track_summary', { mmsi: 419500001, hours: 6 })] }),
      () => ({ text: 'There are 3 BROWSE ships; BROWSE ALPHA (419500001) is open on the map.' }),
    ];
    const res = await ask('Find the browse ships and open the first', { bbox: [50, -25, 60, -15], zoom: 6 });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toMatchObject({ reply: expect.stringContaining('BROWSE ALPHA'), requests: 3, cached: false, usage: { user_used_today: 3 } });
    expect(body.actions).toEqual([{ type: 'show_ship', mmsi: 419500001, name: 'BROWSE ALPHA', lat: -20.9, lon: 55.1 }]);
    expect(body.ships.map((s: { mmsi: number }) => s.mmsi)).toEqual(expect.arrayContaining([419500001, 419500002]));

    // The tool results the model saw: compact, and the view/system context was passed along.
    const fromRound2 = responsesIn(aiCalls[1]!);
    const search = fromRound2.find((r) => r.name === 'search_ships')!.response!.result as { total: number; ships: { name: string }[] };
    expect(search.total).toBe(3);
    expect(search.ships.map((s) => s.name)).toEqual(['BROWSE ALPHA', 'BROWSE BRAVO']);
    const zones = fromRound2.find((r) => r.name === 'list_zones')!.response!.result as { zones: { name: string }[] };
    expect(zones.zones.map((z) => z.name)).toContain('Reunion Box');
    expect(zones.zones.map((z) => z.name)).not.toContain('Private Box'); // someone else's personal zone
    const track = responsesIn(aiCalls[2]!).find((r) => r.name === 'get_track_summary')!.response!.result as { points: number };
    expect(track.points).toBeGreaterThanOrEqual(1);
    expect(aiCalls[0]!.systemInstruction).toContain('Current map view');
    expect(aiCalls.map((c) => c.allowTools)).toEqual([true, true, true]);
  });

  it('answers a repeated question from the cache without calling Gemini', async () => {
    aiCalls.length = 0;
    const res = (await ask('Find the browse ships and open the first', { bbox: [50, -25, 60, -15], zoom: 6 })).json();
    expect(res).toMatchObject({ cached: true, requests: 0, usage: { user_used_today: 3 } });
    expect(res.actions).toHaveLength(1);
    expect(aiCalls).toHaveLength(0);
  });

  it('turns bad tool arguments into errors the model can read, and forces an answer after the last round', async () => {
    aiCalls.length = 0;
    aiScript = [
      () => ({ functionCalls: [call('search_ships', { zone_id: 'Reunion Box' })] }), // a name, not an id
      () => ({ functionCalls: [call('get_ship', { mmsi: 999999999 })] }),
      () => ({ functionCalls: [call('nope', {})] }),
      (req) => ({ text: req.allowTools ? 'should not happen' : 'I could not find that.' }),
    ];
    const res = (await ask('loop forever')).json();
    expect(res).toMatchObject({ reply: 'I could not find that.', requests: 4, actions: [] });
    expect(aiCalls.map((c) => c.allowTools)).toEqual([true, true, true, false]);
    // The last request carries the whole conversation, so every tool result once.
    const errors = responsesIn(aiCalls[3]!).map((r) => r.response!.error);
    expect(errors).toEqual(['zone_id must be an id from list_zones (not a name).', 'Ship not found.', 'Unknown tool nope.']);
  });

  it('stops at the per-user daily budget', async () => {
    aiScript = [() => ({ text: 'one' }), () => ({ text: 'two' }), () => ({ text: 'three' })];
    // 3 + 4 requests used above; the limit is 10.
    expect((await ask('first new question')).statusCode).toBe(200);
    expect((await ask('second new question')).statusCode).toBe(200);
    expect((await ask('third new question')).statusCode).toBe(200);
    const over = await ask('fourth new question');
    expect(over.statusCode).toBe(429);
    expect(over.json().error).toContain('10 AI requests');
    expect(Number(over.headers['retry-after'])).toBeGreaterThan(0);
    expect((await app.inject({ url: '/api/ai/status', headers: auth() })).json().usage.user_used_today).toBe(10);
    aiScript = [];
  });
});

describe('health', () => {
  it('reports db and redis status', async () => {
    const res = await app.inject({ url: '/api/health' });
    expect(res.json()).toMatchObject({ db: true, redis: true });
    const stats = (await app.inject({ url: '/api/stats' })).json();
    expect(stats.vessels_known).toBeGreaterThan(5);
  });
});

describe('AI explain and guide', () => {
  let token = '';
  const auth = () => ({ authorization: `Bearer ${token}` });
  const post = (url: string, payload?: unknown) => app.inject({ method: 'POST', url, headers: auth(), ...(payload ? { payload } : {}) });

  beforeAll(async () => {
    const keys = await redis.keys('ais_test:ai:*');
    if (keys.length) await redis.del(...keys);
    token = (await app.inject({
      method: 'POST', url: '/api/auth/register', remoteAddress: '10.9.9.6', payload: { email: 'explain-user@test.local', password: 'explain-user-pass' },
    })).json().access_token;
  });

  it('briefs a ship from its data, once, then from cache', async () => {
    aiCalls.length = 0;
    aiScript = [() => ({ text: 'BROWSE ALPHA is a cargo ship near Réunion, nothing unusual.' })];
    const res = await post('/api/ai/explain/ship/419500001');
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ text: expect.stringContaining('BROWSE ALPHA'), cached: false, usage: { user_used_today: 1 } });
    // One plain request: no map tools, the ship's data in the prompt.
    expect(aiCalls).toHaveLength(1);
    expect(aiCalls[0]).toMatchObject({ tools: false, allowTools: false });
    expect(aiCalls[0]!.systemInstruction).toContain('briefing');
    const data = JSON.parse((aiCalls[0]!.contents[0]!.parts![0] as { text: string }).text);
    expect(data.ship).toMatchObject({ mmsi: 419500001, name: 'BROWSE ALPHA' });
    expect(data).toHaveProperty('last_24h');

    const again = (await post('/api/ai/explain/ship/419500001')).json();
    expect(again).toMatchObject({ cached: true, usage: { user_used_today: 1 } });
    expect(aiCalls).toHaveLength(1);

    const unknown = await post('/api/ai/explain/ship/999999999');
    expect(unknown.statusCode).toBe(404);
    expect((await app.inject({ method: 'POST', url: '/api/ai/explain/ship/419500001' })).statusCode).toBe(401);
  });

  it('explains an alert the user can see, and 404s otherwise', async () => {
    const { rows } = await pool.query(
      `INSERT INTO alerts (type, severity, mmsi, geom, details)
       VALUES ('loitering', 'warning', 419500001, ST_SetSRID(ST_MakePoint(55.1, -20.9), 4326)::geography, '{"minutes": 45}')
       RETURNING id`,
    );
    const id = rows[0].id as string;
    expect((await app.inject({ url: `/api/alerts/${id}`, headers: auth() })).json()).toMatchObject({ id, type: 'loitering', vessel_name: 'BROWSE ALPHA' });

    aiCalls.length = 0;
    aiScript = [() => ({ text: 'BROWSE ALPHA has been almost stationary for 45 minutes; check whether it is at anchor.' })];
    const res = await post(`/api/ai/explain/alert/${id}`);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ text: expect.stringContaining('45 minutes'), cached: false });
    const data = JSON.parse((aiCalls[0]!.contents[0]!.parts![0] as { text: string }).text);
    expect(data.alert).toMatchObject({ type: 'loitering', details: { minutes: 45 } });
    expect((await post(`/api/ai/explain/alert/${id}`)).json()).toMatchObject({ cached: true });

    expect((await post('/api/ai/explain/alert/00000000-0000-4000-8000-000000000000')).statusCode).toBe(404);
    expect((await post('/api/ai/explain/alert/not-a-uuid')).statusCode).toBe(400);
    await pool.query(`DELETE FROM alerts WHERE id = $1`, [id]);
  });

  it('plans shadow-cursor steps as JSON, keeping only controls on the screen', async () => {
    const targets = [
      { id: 'nav.zones', label: 'Zones', hint: 'Opens your pins and zones' },
      { id: 'objects.drawZone', label: 'Draw zone' },
      { id: 'zoneForm.alerts', label: 'Alerts switch' },
    ];
    aiCalls.length = 0;
    aiScript = [
      () => ({
        text: JSON.stringify({
          title: 'Get alerts for an area',
          steps: [
            { target: 'nav.zones', say: 'Open Zones', action: 'click' },
            { target: 'made.up', say: 'Invented control', action: 'click' },
            { target: 'objects.drawZone', say: 'Choose Draw zone', action: 'click' },
            { target: 'zoneForm.alerts', say: 'Turn alerts on', action: 'click' },
          ],
        }),
      }),
    ];
    const body = { question: 'How do I get alerts when ships enter an area?', layout: 'phone', panel: null, targets };
    const res = await post('/api/ai/guide', body);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ title: 'Get alerts for an area', cached: false, note: null });
    expect(res.json().steps.map((s: { target: string }) => s.target)).toEqual(['nav.zones', 'objects.drawZone', 'zoneForm.alerts']);
    // Structured output, restricted to the controls sent.
    const schema = aiCalls[0]!.json as { properties: { steps: { items: { properties: { target: { enum: string[] } } } } } };
    expect(schema.properties.steps.items.properties.target.enum).toEqual(['nav.zones', 'objects.drawZone', 'zoneForm.alerts']);

    expect((await post('/api/ai/guide', { ...body, question: '  how do I get ALERTS when ships enter an area? ' })).json()).toMatchObject({ cached: true });

    aiScript = [() => ({ text: 'not json' })];
    expect((await post('/api/ai/guide', { ...body, question: 'How do I export a PDF?' })).statusCode).toBe(502);
    expect((await post('/api/ai/guide', { ...body, targets: [{ id: 'Bad Id!', label: 'x' }] })).statusCode).toBe(400);
  });
});
