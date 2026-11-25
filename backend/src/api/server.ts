import compress from '@fastify/compress';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import websocket from '@fastify/websocket';
import Fastify from 'fastify';
import type { Redis } from 'ioredis';
import { config } from '../config.js';
import { logger } from '../shared/logger.js';
import { attachUser } from './auth/guard.js';
import { errorHandler } from './errors.js';
import { alertRoutes } from './routes/alerts.js';
import { authRoutes } from './routes/auth.js';
import { healthRoutes } from './routes/health.js';
import { shipRoutes } from './routes/ships.js';
import { userRoutes } from './routes/users.js';
import { vesselRoutes } from './routes/vessels.js';
import { zoneRoutes } from './routes/zones.js';
import { wsRoutes } from './ws.js';

export async function buildServer(deps: { redis: Redis; subscriber: Redis }) {
  const app = Fastify({
    loggerInstance: logger,
    trustProxy: true,
    bodyLimit: 2 * 1024 * 1024, // zones can carry large polygons
  });

  await app.register(helmet, { contentSecurityPolicy: false });
  await app.register(cors, {
    origin: config.CORS_ORIGIN.split(',').map((s) => s.trim()),
    methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  });
  await app.register(compress, { threshold: 1024 });
  await app.register(rateLimit, { max: 600, timeWindow: '1 minute' });
  await app.register(websocket, { options: { maxPayload: 64 * 1024 } });

  app.decorateRequest('user', null);
  app.addHook('onRequest', attachUser);
  app.setErrorHandler(errorHandler);

  await app.register(healthRoutes, { redis: deps.redis });
  await app.register(shipRoutes);
  await app.register(vesselRoutes);
  await app.register(zoneRoutes);
  await app.register(alertRoutes);
  await app.register(authRoutes);
  await app.register(userRoutes);
  await app.register(wsRoutes, { subscriber: deps.subscriber });

  return app;
}
