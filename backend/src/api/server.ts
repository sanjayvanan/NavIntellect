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
import type { ModelClient } from '../ai/copilot.js';
import { aiRoutes } from './routes/ai.js';
import { alertRoutes } from './routes/alerts.js';
import { authRoutes } from './routes/auth.js';
import { preferenceRoutes } from './routes/preferences.js';
import { annotationRoutes } from './routes/annotations.js';
import { healthRoutes } from './routes/health.js';
import { shipRoutes } from './routes/ships.js';
import { userRoutes } from './routes/users.js';
import { vesselRoutes } from './routes/vessels.js';
import { zoneRoutes } from './routes/zones.js';
import { ShipCache } from './shipCache.js';
import { wsRoutes } from './ws.js';

/** `aiModel` replaces Gemini (tests). */
export async function buildServer(deps: { redis: Redis; subscriber: Redis; aiModel?: ModelClient }) {
  const app = Fastify({
    loggerInstance: logger,
    trustProxy: true,
    bodyLimit: 2 * 1024 * 1024, // zones can carry large polygons
  });

  await app.register(helmet, { contentSecurityPolicy: false });
  await app.register(cors, {
    origin: config.CORS_ORIGIN.split(',').map((s) => s.trim()),
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  });
  await app.register(compress, { threshold: 1024 });
  await app.register(rateLimit, { max: 600, timeWindow: '1 minute' });
  await app.register(websocket, { options: { maxPayload: 64 * 1024 } });

  app.decorateRequest('user', null);
  app.addHook('onRequest', attachUser);
  app.setErrorHandler(errorHandler);

  await app.register(healthRoutes, { redis: deps.redis });
  const shipCache = new ShipCache();
  await shipCache.start(deps.subscriber);
  app.addHook('onClose', async () => shipCache.stop());
  await app.register(shipRoutes, { cache: shipCache });
  await app.register(vesselRoutes);
  await app.register(zoneRoutes);
  await app.register(alertRoutes);
  await app.register(authRoutes);
  await app.register(userRoutes);
  await app.register(preferenceRoutes);
  await app.register(annotationRoutes);
  await app.register(aiRoutes, { redis: deps.redis, model: deps.aiModel });
  await app.register(wsRoutes, { subscriber: deps.subscriber });

  return app;
}
