import { createHash } from 'node:crypto';
import type { Content, FunctionCall, Part } from '@google/genai';
import type { Redis } from 'ioredis';
import { BudgetError, type AiBudget, type Usage } from './budget.js';
import { runTool, TOOL_DECLARATIONS, type ApiGet, type MapAction, type ShipRef, type ToolContext } from './tools.js';

/**
 * Map copilot: answers questions about the live ship data with Gemini function calling.
 *
 *   question -> Gemini -> tool calls (run against the app's own API as the user) -> Gemini -> ...
 *            -> answer + map actions for the browser (open a ship, draw a track, zoom to a zone)
 *
 * Free tier: every Gemini request is reserved from the budget first; the tool rounds are capped
 * and on the last round the model must answer (no more tool calls); identical questions on the
 * same view are answered from a short-lived cache.
 */

/** The part of the Gemini client this needs (lets tests use a scripted fake). */
export interface ModelClient {
  generate(req: {
    contents: Content[];
    systemInstruction: string;
    allowTools: boolean;
    /** false: no map tools declared at all (one-shot answers: explanations, guides). */
    tools?: boolean;
    /** Answer as JSON matching this JSON Schema (structured output). */
    json?: Record<string, unknown>;
    maxTokens?: number;
  }): Promise<{ functionCalls?: FunctionCall[]; text?: string; content?: Content; tokens?: number }>;
}

/**
 * Reserves one Gemini request in the free-tier budget. When only the per-minute limit is hit,
 * waits once (up to MAX_MINUTE_WAIT_S) and tries again; otherwise a 429 CopilotError.
 */
export async function reserveRequest(budget: AiBudget, userId: string, sleep?: (s: number) => Promise<void>) {
  for (let attempt = 0; ; attempt++) {
    try {
      return await budget.take(userId);
    } catch (err) {
      if (err instanceof BudgetError && err.kind === 'minute' && attempt === 0 && err.retryAfter <= MAX_MINUTE_WAIT_S) {
        await (sleep ?? ((s) => new Promise((r) => setTimeout(r, s * 1000))))(err.retryAfter);
        continue;
      }
      if (err instanceof BudgetError) throw new CopilotError(429, err.message, err.retryAfter);
      throw err;
    }
  }
}

export interface ChatMessage {
  role: 'user' | 'assistant';
  text: string;
}

export interface CopilotContext {
  bbox?: [number, number, number, number] | null;
  zoom?: number | null;
  selected?: { mmsi: number; name?: string } | null;
}

export interface CopilotResult {
  reply: string;
  actions: MapAction[];
  ships: ShipRef[];
  requests: number;
  tokens: number;
  cached: boolean;
  usage: Usage;
}

export class CopilotError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly retryAfter?: number,
  ) {
    super(message);
  }
}

const CACHE_TTL_S = 120;
const MAX_MINUTE_WAIT_S = 12; // wait this long for the per-minute limit before giving up

const SYSTEM = `You are the copilot of a coastal surveillance web app that shows live AIS ship positions on a map.
Users are maritime operators. Answer questions about ships, zones (areas drawn on the map) and alerts using the tools; never invent ships, numbers or positions.
- Prefer one search with filters over many calls. Call independent tools together in one turn.
- "Here", "on my screen", "in view" = search_ships with area "view".
- For a named sea, strait or port you know, pass a bbox (and use fly_to when the user wants to go there).
- When the user wants to see, open, find or follow something, also call the matching map tool (show_ship, show_track, show_zone, fly_to). For "list all"/"browse", use filter_ship_list.
- Zones are referenced by id: call list_zones first to find the id of a zone named by the user.
- Speeds are in knots, distances in nautical miles. Times are UTC unless the user says otherwise.
- Reply in plain text (no markdown tables), short: 1-4 sentences or a short list. Name ships with their name and MMSI.
- If something cannot be answered with the tools, say so briefly. Data covers ships heard in the last 50 hours; tracks about 3 days.`;

function contextText(ctx: CopilotContext) {
  const lines = [`Now: ${new Date().toISOString().slice(0, 16)}Z.`];
  if (ctx.bbox) lines.push(`Current map view (minLon,minLat,maxLon,maxLat): ${ctx.bbox.map((v) => v.toFixed(2)).join(',')}; zoom ${ctx.zoom ?? '?'}.`);
  if (ctx.selected) lines.push(`Selected ship: ${ctx.selected.name ?? 'MMSI ' + ctx.selected.mmsi} (MMSI ${ctx.selected.mmsi}).`);
  return lines.join('\n');
}

export class Copilot {
  constructor(
    private readonly deps: {
      model: ModelClient;
      budget: AiBudget;
      redis: Redis;
      cachePrefix: string;
      maxToolRounds: number;
      /** Seconds to wait; injectable so tests do not sleep. */
      sleep?: (s: number) => Promise<void>;
    },
  ) {}

  /** Reserves one Gemini request; waits briefly when only the per-minute limit is hit. */
  private reserve(userId: string) {
    return reserveRequest(this.deps.budget, userId, this.deps.sleep);
  }

  async ask(opts: { userId: string; messages: ChatMessage[]; context: CopilotContext; get: ApiGet }): Promise<CopilotResult> {
    const { userId, messages, context, get } = opts;
    const question = messages[messages.length - 1];
    if (!question || question.role !== 'user' || !question.text.trim()) throw new CopilotError(400, 'Ask a question.');

    // Same user, same question, same view, no earlier conversation: reuse the answer for a while.
    const cacheKey =
      messages.length === 1
        ? `${this.deps.cachePrefix}:ai:copilot:` +
          createHash('sha256')
            .update(JSON.stringify([userId, question.text.trim().toLowerCase(), context.bbox?.map((v) => v.toFixed(1)), context.selected?.mmsi ?? null]))
            .digest('hex')
            .slice(0, 32)
        : null;
    if (cacheKey) {
      const hit = await this.deps.redis.get(cacheKey);
      if (hit) {
        const cached = JSON.parse(hit) as Omit<CopilotResult, 'usage' | 'cached'>;
        return { ...cached, requests: 0, tokens: 0, cached: true, usage: await this.deps.budget.usage(userId) };
      }
    }

    const contents: Content[] = messages.slice(-8).map((m) => ({ role: m.role === 'user' ? 'user' : 'model', parts: [{ text: m.text }] }));
    const systemInstruction = `${SYSTEM}\n\n${contextText(context)}`;
    const toolCtx: ToolContext = { get, viewBbox: context.bbox ?? null, actions: [], ships: new Map() };
    let requests = 0;
    let tokens = 0;
    let reply = '';

    for (let round = 0; ; round++) {
      const allowTools = round < this.deps.maxToolRounds;
      await this.reserve(userId);
      requests++;
      const res = await this.deps.model.generate({ contents, systemInstruction, allowTools });
      tokens += res.tokens ?? 0;
      const calls = allowTools ? (res.functionCalls ?? []) : [];
      if (!calls.length) {
        reply = res.text?.trim() || '';
        break;
      }
      // The model turn goes back unchanged (it may carry thought signatures the API requires).
      contents.push(res.content ?? { role: 'model', parts: calls.map((c) => ({ functionCall: c })) });
      const parts: Part[] = await Promise.all(
        calls.map(async (c) => ({
          functionResponse: { id: c.id, name: c.name, response: await runTool(c.name ?? '', c.args ?? {}, toolCtx) },
        })),
      );
      contents.push({ role: 'user', parts });
    }

    if (!reply) reply = toolCtx.actions.length ? 'Done.' : "Sorry, I couldn't find an answer to that.";
    const result = { reply, actions: toolCtx.actions, ships: [...toolCtx.ships.values()], requests, tokens };
    if (cacheKey) await this.deps.redis.set(cacheKey, JSON.stringify(result), 'EX', CACHE_TTL_S);
    return { ...result, cached: false, usage: await this.deps.budget.usage(userId) };
  }
}

export { TOOL_DECLARATIONS };
