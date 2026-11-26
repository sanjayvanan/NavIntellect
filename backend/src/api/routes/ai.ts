import type { FastifyInstance } from 'fastify';
import type { Redis } from 'ioredis';
import { z } from 'zod';
import { AiBudget } from '../../ai/budget.js';
import { Copilot, CopilotError, type ModelClient } from '../../ai/copilot.js';
import { geminiClient } from '../../ai/gemini.js';
import { config } from '../../config.js';
import { requireRole } from '../auth/guard.js';
import { HttpError, parse } from '../errors.js';

const askBody = z.object({
  messages: z
    .array(z.object({ role: z.enum(['user', 'assistant']), text: z.string().trim().min(1).max(2000) }))
    .min(1)
    .max(20),
  context: z
    .object({
      /** Map view [minLon, minLat, maxLon, maxLat] (minLon > maxLon across the antimeridian). */
      bbox: z
        .tuple([z.number().min(-180).max(180), z.number().min(-90).max(90), z.number().min(-180).max(180), z.number().min(-90).max(90)])
        .nullable()
        .optional(),
      zoom: z.number().min(0).max(24).nullable().optional(),
      selected: z.object({ mmsi: z.number().int().positive(), name: z.string().max(120).optional() }).nullable().optional(),
    })
    .default({}),
});

/**
 * AI routes (signed-in users only, so each person has their own daily budget).
 *   GET  /api/ai/status   -> { enabled, model, usage }
 *   POST /api/ai/copilot  -> { reply, actions, ships, usage, ... }
 * Without GEMINI_API_KEY (and no test model) the AI is reported as disabled.
 */
export async function aiRoutes(app: FastifyInstance, opts: { redis: Redis; model?: ModelClient }) {
  const model = opts.model ?? (config.GEMINI_API_KEY ? geminiClient(config.GEMINI_API_KEY, config.GEMINI_MODEL) : null);
  const budget = new AiBudget(opts.redis, config.DB_SCHEMA, {
    daily: config.AI_DAILY_LIMIT,
    userDaily: config.AI_USER_DAILY_LIMIT,
    perMinute: config.AI_RPM,
  });
  const copilot = model
    ? new Copilot({ model, budget, redis: opts.redis, cachePrefix: config.DB_SCHEMA, maxToolRounds: config.AI_MAX_TOOL_ROUNDS })
    : null;
  const viewer = { preHandler: requireRole('viewer') };

  app.get('/api/ai/status', viewer, async (req) => ({
    enabled: Boolean(copilot),
    model: copilot ? config.GEMINI_MODEL : null,
    usage: await budget.usage(req.user!.id),
  }));

  app.post('/api/ai/copilot', viewer, async (req, reply) => {
    if (!copilot) throw new HttpError(503, 'AI is not set up on this server (GEMINI_API_KEY is missing).');
    const body = parse(askBody, req.body);
    // Tools read the app's own API as this user: same validation, same visibility rules.
    const authorization = req.headers.authorization;
    const get = async (path: string) => {
      const res = await app.inject({ method: 'GET', url: path, headers: authorization ? { authorization } : {} });
      let json: unknown = null;
      try {
        json = res.json();
      } catch {
        // not JSON
      }
      return { status: res.statusCode, body: json };
    };
    try {
      return await copilot.ask({
        userId: req.user!.id,
        messages: body.messages,
        context: { bbox: body.context.bbox ?? null, zoom: body.context.zoom ?? null, selected: body.context.selected ?? null },
        get,
      });
    } catch (err) {
      if (err instanceof CopilotError) {
        if (err.retryAfter) reply.header('Retry-After', String(err.retryAfter));
        throw new HttpError(err.status, err.message);
      }
      throw err;
    }
  });
}
