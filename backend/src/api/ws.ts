import type { FastifyInstance } from 'fastify';
import type { Redis } from 'ioredis';
import type { WebSocket } from 'ws';
import { z } from 'zod';
import type { AlertRow } from '../alerts/engine.js';
import { config } from '../config.js';
import type { LegacyShip } from '../ingest/types.js';
import { logger } from '../shared/logger.js';
import { CHANNELS } from '../shared/redis.js';
import { verifyAccessToken } from './auth/tokens.js';

type BBox = [number, number, number, number]; // minLon, minLat, maxLon, maxLat

interface Client {
  socket: WebSocket;
  /** Signed-in user, or null for an anonymous connection. */
  userId: string | null;
  bbox: BBox | null;
  alerts: boolean;
  alive: boolean;
}

const clientMsg = z.object({
  subscribe: z
    .object({
      bbox: z.tuple([z.number(), z.number(), z.number(), z.number()]).nullable().optional(),
      alerts: z.boolean().optional(),
    })
    .optional(),
});

/**
 * Same visibility rule as GET /api/alerts: alerts of shared zones (or without a zone) reach every
 * client; alerts of a personal zone reach only that zone's owner.
 */
export const canReceive = (alert: Pick<AlertRow, 'zone_owner_id'>, userId: string | null) =>
  !alert.zone_owner_id || alert.zone_owner_id === userId;

const PUSH_INTERVAL_MS = 1000;
const MAX_BUFFERED_BYTES = 2 * 1024 * 1024;

/** minLon > maxLon means the box crosses the antimeridian (same rule as bboxSql). */
const inBox = (s: LegacyShip, b: BBox) =>
  s.latitude >= b[1] && s.latitude <= b[3] &&
  (b[0] <= b[2] ? s.longitude >= b[0] && s.longitude <= b[2] : s.longitude >= b[0] || s.longitude <= b[2]);

/**
 * WebSocket at /ws. Protocol:
 *   client -> {"subscribe": {"bbox": [minLon,minLat,maxLon,maxLat] | null, "alerts": true}}
 *   server -> {"type":"vessels","data":[LegacyShip...]}   (coalesced, at most once per second)
 *   server -> {"type":"alert","data":AlertRow}   (personal-zone alerts only to the zone's owner)
 * Updates arrive from the ingestor via Redis pub/sub, so any number of API instances can serve clients.
 */
export async function wsRoutes(app: FastifyInstance, opts: { subscriber: Redis }) {
  const clients = new Set<Client>();
  const pending = new Map<number, LegacyShip>();

  await opts.subscriber.subscribe(CHANNELS.vessels, CHANNELS.alerts);
  opts.subscriber.on('message', (channel: string, payload: string) => {
    try {
      if (channel === CHANNELS.vessels) {
        for (const s of JSON.parse(payload) as LegacyShip[]) pending.set(s.mmsi, s);
      } else if (channel === CHANNELS.alerts) {
        for (const a of JSON.parse(payload) as AlertRow[]) {
          const msg = JSON.stringify({ type: 'alert', data: a });
          for (const c of clients) if (c.alerts && canReceive(a, c.userId)) send(c, msg);
        }
      }
    } catch (err) {
      logger.warn({ err }, 'bad pubsub payload');
    }
  });

  const flushTimer = setInterval(() => {
    if (pending.size === 0 || clients.size === 0) {
      pending.clear();
      return;
    }
    const all = [...pending.values()];
    pending.clear();
    const allMsg = JSON.stringify({ type: 'vessels', data: all });
    for (const c of clients) {
      if (!c.bbox) send(c, allMsg);
      else {
        const box = c.bbox;
        const data = all.filter((s) => inBox(s, box));
        if (data.length) send(c, JSON.stringify({ type: 'vessels', data }));
      }
    }
  }, PUSH_INTERVAL_MS);

  const heartbeat = setInterval(() => {
    for (const c of clients) {
      if (!c.alive) {
        c.socket.terminate();
        continue;
      }
      c.alive = false;
      c.socket.ping();
    }
  }, 30_000);

  app.addHook('onClose', async () => {
    clearInterval(flushTimer);
    clearInterval(heartbeat);
    for (const c of clients) c.socket.close(1001, 'server shutting down');
  });

  app.get('/ws', { websocket: true }, async (socket, req) => {
    const token = (req.query as { token?: string }).token;
    let userId: string | null = null;
    if (token) {
      try {
        userId = (await verifyAccessToken(token)).id;
      } catch {
        socket.close(4401, 'invalid token');
        return;
      }
    } else if (config.AUTH_REQUIRED_FOR_READS) {
      socket.close(4401, 'authentication required');
      return;
    }

    const client: Client = { socket, userId, bbox: null, alerts: true, alive: true };
    clients.add(client);
    socket.on('pong', () => (client.alive = true));
    socket.on('close', () => clients.delete(client));
    socket.on('message', (raw) => {
      let parsed: unknown;
      try {
        parsed = JSON.parse(raw.toString());
      } catch {
        return send(client, JSON.stringify({ type: 'error', error: 'invalid JSON' }));
      }
      const r = clientMsg.safeParse(parsed);
      if (!r.success) return send(client, JSON.stringify({ type: 'error', error: 'invalid message' }));
      if (r.data.subscribe) {
        if (r.data.subscribe.bbox !== undefined) client.bbox = r.data.subscribe.bbox;
        if (r.data.subscribe.alerts !== undefined) client.alerts = r.data.subscribe.alerts;
        send(client, JSON.stringify({ type: 'subscribed', bbox: client.bbox, alerts: client.alerts }));
      }
    });
    send(client, JSON.stringify({ type: 'hello', push_interval_ms: PUSH_INTERVAL_MS }));
  });
}

function send(c: Client, msg: string) {
  // Slow consumer protection: skip frames rather than buffer unbounded memory.
  if (c.socket.readyState !== c.socket.OPEN || c.socket.bufferedAmount > MAX_BUFFERED_BYTES) return;
  c.socket.send(msg);
}
