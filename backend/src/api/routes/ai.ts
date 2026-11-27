import type { FastifyInstance, FastifyReply } from 'fastify';
import type { Redis } from 'ioredis';
import { z } from 'zod';
import { AiBudget } from '../../ai/budget.js';
import { Copilot, CopilotError, type ModelClient } from '../../ai/copilot.js';
import { Explainer } from '../../ai/explain.js';
import { geminiClient } from '../../ai/gemini.js';
import { AiTracer, pgTraceSink } from '../../ai/trace.js';
import { config } from '../../config.js';
import { pool } from '../../db/pool.js';
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
 *   POST /api/ai/copilot/stream -> Server-Sent Events: tools, delta, discard, then done (the same
 *                                  result as /copilot) or error ({ status, error, retry_after })
 *   POST /api/ai/explain/ship/:mmsi -> { text, cached, usage }   (ship briefing)
 *   POST /api/ai/explain/alert/:id  -> { text, cached, usage }   (why an alert matters)
 *   POST /api/ai/guide    -> { title, steps: [{ target, say, action }], note, cached, usage }
 *   GET  /api/ai/metrics?hours=24  (admin) -> latency, tokens, cost, errors, cache hits, tool failures
 *   GET  /api/ai/traces?limit=&feature=  (admin) -> recent runs with each request and its tool calls
 * Without GEMINI_API_KEY (and no test model) the AI is reported as disabled.
 */
export async function aiRoutes(app: FastifyInstance, opts: { redis: Redis; model?: ModelClient }) {
  const model = opts.model ?? (config.GEMINI_API_KEY ? geminiClient(config.GEMINI_API_KEY, config.GEMINI_MODEL) : null);
  const budget = new AiBudget(opts.redis, config.DB_SCHEMA, {
    daily: config.AI_DAILY_LIMIT,
    userDaily: config.AI_USER_DAILY_LIMIT,
    perMinute: config.AI_RPM,
  });
  const tracer = new AiTracer(pgTraceSink((sql, params) => pool.query(sql, params)), {
    model: config.GEMINI_MODEL,
    prices: { inputPerM: config.AI_PRICE_INPUT_PER_M, outputPerM: config.AI_PRICE_OUTPUT_PER_M },
  });
  const copilot = model
    ? new Copilot({ model, budget, tracer, redis: opts.redis, cachePrefix: config.DB_SCHEMA, maxToolRounds: config.AI_MAX_TOOL_ROUNDS })
    : null;
  const explainer = model ? new Explainer({ model, budget, tracer, redis: opts.redis, cachePrefix: config.DB_SCHEMA }) : null;
  const viewer = { preHandler: requireRole('viewer') };
  const admin = { preHandler: requireRole('admin') };

  const metricsQuery = z.object({ hours: z.coerce.number().int().min(1).max(24 * 90).default(24) });
  app.get('/api/ai/metrics', admin, async (req) => {
    const { hours } = parse(metricsQuery, req.query);
    const [byPrompt, tools] = await Promise.all([
      pool.query(
        `SELECT feature, model, prompt_version,
                count(DISTINCT run_id)::int AS runs,
                (count(*) FILTER (WHERE outcome <> 'cache_hit'))::int AS requests,
                (count(*) FILTER (WHERE outcome = 'cache_hit'))::int AS cache_hits,
                (count(*) FILTER (WHERE outcome = 'error'))::int AS errors,
                round(percentile_cont(0.5) WITHIN GROUP (ORDER BY latency_ms) FILTER (WHERE outcome <> 'cache_hit'))::int AS p50_ms,
                round(percentile_cont(0.95) WITHIN GROUP (ORDER BY latency_ms) FILTER (WHERE outcome <> 'cache_hit'))::int AS p95_ms,
                round(percentile_cont(0.5) WITHIN GROUP (ORDER BY ttft_ms))::int AS p50_ttft_ms,
                sum(prompt_tokens)::int AS prompt_tokens,
                sum(output_tokens)::int AS output_tokens,
                round(sum(cost_usd), 6)::float8 AS cost_usd
         FROM ai_requests WHERE created_at > now() - make_interval(hours => $1)
         GROUP BY feature, model, prompt_version
         ORDER BY runs DESC`,
        [hours],
      ),
      pool.query(
        `SELECT t->>'name' AS tool, count(*)::int AS calls,
                (count(*) FILTER (WHERE (t->>'ok')::boolean IS FALSE))::int AS failures,
                round(avg((t->>'ms')::numeric))::int AS avg_ms
         FROM ai_requests, jsonb_array_elements(tool_calls) t
         WHERE created_at > now() - make_interval(hours => $1)
         GROUP BY 1 ORDER BY calls DESC`,
        [hours],
      ),
    ]);
    return { hours, by_prompt: byPrompt.rows, tools: tools.rows };
  });

  const tracesQuery = z.object({
    limit: z.coerce.number().int().min(1).max(200).default(50),
    feature: z.enum(['copilot', 'brief', 'alert', 'guide']).optional(),
  });
  app.get('/api/ai/traces', admin, async (req) => {
    const q = parse(tracesQuery, req.query);
    const { rows } = await pool.query(
      `SELECT run_id, min(created_at) AS started_at, min(feature) AS feature, min(user_id::text) AS user_id,
              min(model) AS model, min(prompt_version) AS prompt_version,
              sum(latency_ms)::int AS latency_ms, sum(prompt_tokens + output_tokens)::int AS tokens,
              round(sum(cost_usd), 6)::float8 AS cost_usd,
              jsonb_agg(jsonb_build_object('round', round, 'outcome', outcome, 'error', error, 'latency_ms', latency_ms, 'ttft_ms', ttft_ms,
                                           'prompt_tokens', prompt_tokens, 'output_tokens', output_tokens, 'tool_calls', tool_calls)
                        ORDER BY round) AS requests
       FROM ai_requests
       WHERE run_id IN (SELECT run_id FROM ai_requests WHERE ($2::text IS NULL OR feature = $2)
                        GROUP BY run_id ORDER BY max(created_at) DESC LIMIT $1)
       GROUP BY run_id ORDER BY started_at DESC`,
      [q.limit, q.feature ?? null],
    );
    return rows;
  });

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

  app.post('/api/ai/copilot/stream', viewer, async (req, reply) => {
    if (!copilot) throw new HttpError(503, 'AI is not set up on this server (GEMINI_API_KEY is missing).');
    const body = parse(askBody, req.body);
    const get = apiAs(req.headers.authorization);
    // From here on the response is a stream: Fastify's serialisation and hooks are bypassed, so the
    // headers already set (CORS, security) are copied over by hand.
    reply.hijack();
    const raw = reply.raw;
    raw.writeHead(200, {
      ...(reply.getHeaders() as Record<string, string>),
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache, no-transform',
      'x-accel-buffering': 'no', // proxies (nginx) must not buffer the stream
      connection: 'keep-alive',
    });
    let open = true;
    raw.on('close', () => {
      open = false;
    });
    const send = (event: string, data: unknown) => {
      if (open) raw.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    };
    try {
      const result = await copilot.ask({
        userId: req.user!.id,
        messages: body.messages,
        context: { bbox: body.context.bbox ?? null, zoom: body.context.zoom ?? null, selected: body.context.selected ?? null },
        get,
        onEvent: (e) => send(e.type, e),
      });
      send('done', result);
    } catch (err) {
      if (err instanceof CopilotError) send('error', { status: err.status, error: err.message, retry_after: err.retryAfter ?? null });
      else {
        req.log.error({ err }, 'copilot stream failed');
        send('error', { status: 500, error: 'Something went wrong.' });
      }
    } finally {
      raw.end();
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
