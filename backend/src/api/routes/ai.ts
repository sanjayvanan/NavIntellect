import type { FastifyInstance, FastifyReply } from 'fastify';
import type { Redis } from 'ioredis';
import { z } from 'zod';
import { AiBudget } from '../../ai/budget.js';
import { Copilot, CopilotError, type ModelClient } from '../../ai/copilot.js';
import { Explainer } from '../../ai/explain.js';
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

const guideBody = z.object({
  question: z.string().trim().min(3).max(300),
  layout: z.enum(['desktop', 'phone']),
  /** The panel open right now (so the guide starts from where the user is). */
  panel: z.string().max(40).nullable().default(null),
  /** Controls on the user's screen the guide may point at. */
  targets: z
    .array(z.object({ id: z.string().regex(/^[a-z][a-zA-Z0-9.-]{1,59}$/), label: z.string().max(80), hint: z.string().max(200).optional() }))
    .min(1)
    .max(80),
});

/**
 * AI routes (signed-in users only, so each person has their own daily budget).
 *   GET  /api/ai/status   -> { enabled, model, usage }
 *   POST /api/ai/copilot  -> { reply, actions, ships, usage, ... }
 *   POST /api/ai/explain/ship/:mmsi -> { text, cached, usage }   (ship briefing)
 *   POST /api/ai/explain/alert/:id  -> { text, cached, usage }   (why an alert matters)
 *   POST /api/ai/guide    -> { title, steps: [{ target, say, action }], note, cached, usage }
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
  const explainer = model ? new Explainer({ model, budget, redis: opts.redis, cachePrefix: config.DB_SCHEMA }) : null;
  const viewer = { preHandler: requireRole('viewer') };

  app.get('/api/ai/status', viewer, async (req) => ({
    enabled: Boolean(copilot),
    model: copilot ? config.GEMINI_MODEL : null,
    usage: await budget.usage(req.user!.id),
  }));

  app.post('/api/ai/copilot', viewer, async (req, reply) => {
    if (!copilot) throw new HttpError(503, 'AI is not set up on this server (GEMINI_API_KEY is missing).');
    const body = parse(askBody, req.body);
    const get = apiAs(req.headers.authorization);
    try {
      return await copilot.ask({
        userId: req.user!.id,
        messages: body.messages,
        context: { bbox: body.context.bbox ?? null, zoom: body.context.zoom ?? null, selected: body.context.selected ?? null },
        get,
      });
    } catch (err) {
      throw toHttp(err, reply);
    }
  });

  const mmsiParams = z.object({ mmsi: z.coerce.number().int().min(1).max(999_999_999) });
  const idParams = z.object({ id: z.uuid() });
  const needAi = () => {
    if (!explainer) throw new HttpError(503, 'AI is not set up on this server (GEMINI_API_KEY is missing).');
    return explainer;
  };

  app.post('/api/ai/explain/ship/:mmsi', viewer, async (req, reply) => {
    const ai = needAi();
    const { mmsi } = parse(mmsiParams, req.params);
    try {
      return await ai.shipBriefing(req.user!.id, mmsi, apiAs(req.headers.authorization));
    } catch (err) {
      throw toHttp(err, reply);
    }
  });

  app.post('/api/ai/explain/alert/:id', viewer, async (req, reply) => {
    const ai = needAi();
    const { id } = parse(idParams, req.params);
    try {
      return await ai.alertExplanation(req.user!.id, id, apiAs(req.headers.authorization));
    } catch (err) {
      throw toHttp(err, reply);
    }
  });

  app.post('/api/ai/guide', viewer, async (req, reply) => {
    const ai = needAi();
    const body = parse(guideBody, req.body);
    try {
      return await ai.guide(req.user!.id, body);
    } catch (err) {
      throw toHttp(err, reply);
    }
  });

  /** Reads the app's own API as this user: same validation, same visibility rules. */
  function apiAs(authorization: string | undefined) {
    return async (path: string) => {
      const res = await app.inject({ method: 'GET', url: path, headers: authorization ? { authorization } : {} });
      let json: unknown = null;
      try {
        json = res.json();
      } catch {
        // not JSON
      }
      return { status: res.statusCode, body: json };
    };
  }
}

function toHttp(err: unknown, reply: FastifyReply) {
  if (err instanceof CopilotError) {
    if (err.retryAfter) reply.header('Retry-After', String(err.retryAfter));
    return new HttpError(err.status, err.message);
  }
  return err;
}
