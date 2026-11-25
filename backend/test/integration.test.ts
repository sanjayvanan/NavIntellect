import type { Redis } from 'ioredis';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import { hashPassword } from '../src/api/auth/password.js';
import { buildServer } from '../src/api/server.js';
import { compactTracks, storageGuard, tracksWatermark } from '../src/db/maintenance.js';
import { pool } from '../src/db/pool.js';
import { normalize } from '../src/ingest/normalize.js';
import { createPipeline } from '../src/ingest/pipeline.js';
import { CHANNELS, createRedis } from '../src/shared/redis.js';
import { positionReport, shipStaticData } from './fixtures/messages.js';

let app: Awaited<ReturnType<typeof buildServer>>;
let redis: Redis;
let subscriber: Redis;
let pipeline: ReturnType<typeof createPipeline>;
let adminToken = '';

const ingest = async (...envelopes: unknown[]) => {
  for (const e of envelopes) pipeline.batcher.push(...normalize(e));
  await pipeline.batcher.flush();
};
const minsAgo = (m: number) => new Date(Date.now() - m * 60_000);

beforeAll(async () => {
  redis = createRedis('test');
  subscriber = createRedis('test-sub');
  pipeline = createPipeline({ redis, flushIntervalMs: 60_000, maxRows: 5000, maxBuffer: 50_000, alertCooldownMinutes: 0 });
  app = await buildServer({ redis, subscriber });
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

    // Area query hits packed and raw data, and misses elsewhere.
    const area = (await app.inject({ url: `/api/tracks/area?bbox=70.5,20,71.2,20.7&from=${minsAgo(360).toISOString()}` })).json();
    expect(area.vessels.find((v: { mmsi: number }) => v.mmsi === mmsi)).toMatchObject({ points: 7 });
    const elsewhere = (await app.inject({ url: `/api/tracks/area?bbox=-50,-50,-49,-49&from=${minsAgo(360).toISOString()}` })).json();
    expect(elsewhere.vessels).toEqual([]);
    expect((await app.inject({ url: '/api/tracks/area?bbox=170,0,-170,10' })).statusCode).toBe(400);
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
    const res = await app.inject({ method: 'POST', url: '/api/zones', headers: { authorization: `Bearer ${viewerToken}` }, payload: {} });
    expect(res.statusCode).toBe(403);
  });
});

describe('geofences and alerts', () => {
  let zoneId = '';
  // Box around Mumbai harbour approaches.
  const square = { type: 'Polygon', coordinates: [[[72.7, 18.8], [73.0, 18.8], [73.0, 19.1], [72.7, 19.1], [72.7, 18.8]]] };

  it('creates a zone from GeoJSON', async () => {
    const res = await app.inject({
      method: 'POST', url: '/api/zones', headers: { authorization: `Bearer ${adminToken}` },
      payload: { name: 'Mumbai Restricted', kind: 'restricted', geometry: square, rules: { max_speed: 8 } },
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
    expect(inside.map((v: { mmsi: number }) => v.mmsi)).toEqual([419200001]);

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
      payload: { name: 'Chennai Anchorage', kind: 'anchorage', geometry: box, rules: { loiter_minutes: 20, alert_on_enter: false } },
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
});

describe('health', () => {
  it('reports db and redis status', async () => {
    const res = await app.inject({ url: '/api/health' });
    expect(res.json()).toMatchObject({ db: true, redis: true });
    const stats = (await app.inject({ url: '/api/stats' })).json();
    expect(stats.vessels_known).toBeGreaterThan(5);
  });
});
