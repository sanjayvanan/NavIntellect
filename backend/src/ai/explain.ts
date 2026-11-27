import { createHash } from 'node:crypto';
import type { Redis } from 'ioredis';
import { z } from 'zod';
import type { AiBudget, Usage } from './budget.js';
import { CopilotError, reserveRequest, type ModelClient } from './copilot.js';
import { runTool, type ApiGet, type ToolContext } from './tools.js';
import { promptVersion, type AiTracer } from './trace.js';
import { cleanText, UNTRUSTED_RULE } from './untrusted.js';

/**
 * One-shot AI features, all on demand (a button press), cached and counted in the same free-tier
 * budget as the copilot:
 * - ship briefing: a short profile of a ship from its details, last 24 h and recent alerts;
 * - alert explanation: what an alert means and what to check next;
 * - guide: step-by-step directions for the on-screen "shadow cursor" (structured JSON output).
 * Data is read through the app's own API as the signed-in user, so the same visibility rules apply.
 */

export interface ExplainResult {
  text: string;
  cached: boolean;
  usage: Usage;
}

export interface GuideStep {
  target: string;
  say: string;
  action: 'click' | 'type' | 'look';
}

export interface GuideResult {
  title: string;
  steps: GuideStep[];
  note: string | null;
  cached: boolean;
  usage: Usage;
}

/** A control on the user's screen the guide may point at (sent by the app for its current layout). */
export interface GuideTarget {
  id: string;
  label: string;
  hint?: string;
}

const SHIP_TTL_S = 2 * 3600; // a briefing is shared by everyone for its hour, kept a little longer
const ALERT_TTL_S = 7 * 86_400; // an alert does not change
const GUIDE_TTL_S = 7 * 86_400; // the app's controls rarely change
const GUIDE_VERSION = 2; // bump when GUIDE_PROMPT changes, so cached guides are made again

const SHIP_PROMPT = `You are a maritime analyst writing for a coastal surveillance operator.
Write a short briefing about the ship in the data: 3 or 4 sentences, at most 75 words.
Cover: what it is; where it is and where it is heading; what it did in the last 24 hours (from the
track summary: distance, speed, long stops, gaps in reception); anything unusual (a long stop at
sea, reception gaps, a speed odd for its type, a missing destination, alerts). If nothing is
unusual, say so in a few words. Use only the data given; when something is missing, say it is not
reported. Plain sentences: no markdown, no lists, no headings. Times in UTC.
${UNTRUSTED_RULE}`;

const ALERT_PROMPT = `You are a maritime analyst helping a coastal surveillance operator triage an alert.
In 2 or 3 sentences (at most 65 words) explain: what happened, why it may matter given the zone
and the ship, and the one thing worth checking next. Alert types: zone_enter / zone_exit (crossed
a zone border), loitering (slow inside a zone for a while), speeding (over the zone's limit),
ais_gap (stopped transmitting inside a zone). Use only the data given; do not invent intent.
Plain sentences: no markdown, no lists.
${UNTRUSTED_RULE}`;

const GUIDE_PROMPT = `You guide people through a ship-tracking map app by pointing at controls on
their screen, one step at a time, like a teacher's cursor. You get the user's question, the
screen layout (desktop or phone), which panel is open, and the list of controls you may point at
(id, label, hint). Reply with JSON: a short title and the steps in order.
Rules:
- Every step's "target" must be one of the given control ids. Never invent ids.
- "say" is one short instruction (at most 90 characters), e.g. "Tap Zones to open your shapes".
- "action": "click" when they must press it, "type" when they must type into it, "look" when
  they only need to look (e.g. a result).
- Start from the current screen: if the needed panel is already open, do not open it again.
- Include the steps done on the map itself (target "map", action "look"), such as drawing the
  zone's corners or tapping a ship, before any step that only appears after them (a form, a
  ship's details). Say exactly what to do there, e.g. "Tap the corners on the map, then Finish".
- Use the fewest steps that complete the task (at most 7).
- If the app cannot do what they ask, return no steps and explain briefly in "note".`;

/** Prompt versions, recorded with every trace (they change when a prompt changes). */
export const PROMPT_VERSIONS = {
  brief: promptVersion(SHIP_PROMPT),
  alert: promptVersion(ALERT_PROMPT),
  guide: promptVersion(GUIDE_PROMPT, GUIDE_VERSION),
};

const guideOutput = z.object({
  title: z.string().trim().min(1).max(100).catch('How to do it'),
  steps: z
    .array(
      z.object({
        target: z.string(),
        say: z.string().trim().min(1).max(160),
        action: z.enum(['click', 'type', 'look']).catch('click'),
      }),
    )
    .max(12)
    .catch([]),
  note: z.string().trim().max(300).nullable().optional(),
});

const hash = (v: unknown) => createHash('sha256').update(JSON.stringify(v)).digest('hex').slice(0, 32);

export class Explainer {
  constructor(
    private readonly deps: {
      model: ModelClient;
      budget: AiBudget;
      redis: Redis;
      cachePrefix: string;
      tracer?: AiTracer;
      sleep?: (s: number) => Promise<void>;
    },
  ) {}

  private key(kind: string, id: string) {
    return `${this.deps.cachePrefix}:ai:${kind}:${id}`;
  }

  /** Cached answer, or ask Gemini once (one request from the user's budget) and cache it. Traced. */
  private async once<T>(
    feature: keyof typeof PROMPT_VERSIONS,
    userId: string,
    key: string,
    ttl: number,
    make: (model: ModelClient) => Promise<T>,
  ): Promise<{ value: T; cached: boolean }> {
    const run = this.deps.tracer?.run({ feature, userId, promptVersion: PROMPT_VERSIONS[feature] });
    try {
      const hit = await this.deps.redis.get(key);
      if (hit) {
        run?.cacheHit();
        return { value: JSON.parse(hit) as T, cached: true };
      }
      await reserveRequest(this.deps.budget, userId, this.deps.sleep);
      const value = await make(run ? run.wrap(this.deps.model) : this.deps.model);
      await this.deps.redis.set(key, JSON.stringify(value), 'EX', ttl);
      return { value, cached: false };
    } finally {
      await run?.finish();
    }
  }

  private async text(model: ModelClient, systemInstruction: string, data: unknown): Promise<string> {
    const res = await model.generate({
      contents: [{ role: 'user', parts: [{ text: JSON.stringify(data) }] }],
      systemInstruction,
      allowTools: false,
      tools: false,
      maxTokens: 400,
    });
    const text = res.text?.trim();
    if (!text) throw new CopilotError(502, 'Gemini returned an empty answer. Try again.');
    return text;
  }

  /** Short profile of a ship (shared by all users for the current hour: ship data is not private). */
  async shipBriefing(userId: string, mmsi: number, get: ApiGet): Promise<ExplainResult> {
    const ctx = toolContext(get);
    const ship = await runTool('get_ship', { mmsi }, ctx);
    if (ship.error) throw new CopilotError(404, String(ship.error));
    const hour = new Date().toISOString().slice(0, 13);
    const { value, cached } = await this.once('brief', userId, this.key('brief', `${mmsi}:${hour}`), SHIP_TTL_S, async (model) => {
      const [track, alerts] = await Promise.all([
        runTool('get_track_summary', { mmsi, hours: 24 }, ctx),
        runTool('get_alerts', { mmsi, hours: 72, limit: 5 }, ctx),
      ]);
      return this.text(model, SHIP_PROMPT, { now: new Date().toISOString(), ship: ship.result, last_24h: track.result ?? track, alerts: alerts.result ?? alerts });
    });
    return { text: value, cached, usage: await this.deps.budget.usage(userId) };
  }

  /** What an alert means. Checked against the user's visibility first (404 otherwise), then cached. */
  async alertExplanation(userId: string, alertId: string, get: ApiGet): Promise<ExplainResult> {
    const res = await get(`/api/alerts/${encodeURIComponent(alertId)}`);
    if (res.status === 404 || res.status === 400) throw new CopilotError(404, 'Alert not found.');
    if (res.status >= 400) throw new CopilotError(502, 'Could not read the alert.');
    const a = res.body as {
      id: string; type: string; severity: string; mmsi: number; vessel_name: string | null; zone_name: string | null;
      zone_kind: string | null; zone_rules: unknown; details: unknown; created_at: string; latitude: number | null; longitude: number | null;
    };
    const { value, cached } = await this.once('alert', userId, this.key('alert', a.id), ALERT_TTL_S, async (model) => {
      const ctx = toolContext(get);
      const [ship, track] = await Promise.all([runTool('get_ship', { mmsi: a.mmsi }, ctx), runTool('get_track_summary', { mmsi: a.mmsi, hours: 6 }, ctx)]);
      return this.text(model, ALERT_PROMPT, {
        now: new Date().toISOString(),
        alert: {
          type: a.type, severity: a.severity, at: a.created_at, details: a.details,
          position: a.latitude != null ? { lat: a.latitude, lon: a.longitude } : null,
          zone: a.zone_name ? { name: cleanText(a.zone_name), kind: a.zone_kind, rules: a.zone_rules } : null,
        },
        ship: ship.result ?? { mmsi: a.mmsi, name: cleanText(a.vessel_name, 40) },
        last_6h: track.result ?? null,
      });
    });
    return { text: value, cached, usage: await this.deps.budget.usage(userId) };
  }

  /**
   * Steps for the shadow-cursor guide. Gemini answers with JSON (structured output) restricted to
   * the controls on the user's screen; any step pointing elsewhere is dropped. Cached per question,
   * layout and open panel (the same for everyone).
   */
  async guide(
    userId: string,
    req: { question: string; layout: 'desktop' | 'phone'; panel: string | null; targets: GuideTarget[] },
  ): Promise<GuideResult> {
    const ids = req.targets.map((t) => t.id);
    if (!ids.length) throw new CopilotError(400, 'No controls to point at.');
    const question = req.question.trim().replace(/\s+/g, ' ');
    const key = this.key('guide', hash([GUIDE_VERSION, question.toLowerCase(), req.layout, req.panel, ids]));
    const { value, cached } = await this.once('guide', userId, key, GUIDE_TTL_S, async (model) => {
      const res = await model.generate({
        contents: [{ role: 'user', parts: [{ text: JSON.stringify({ question, layout: req.layout, open_panel: req.panel, controls: req.targets }) }] }],
        systemInstruction: GUIDE_PROMPT,
        allowTools: false,
        tools: false,
        maxTokens: 700,
        json: {
          type: 'object',
          properties: {
            title: { type: 'string' },
            steps: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  target: { type: 'string', enum: ids },
                  say: { type: 'string' },
                  action: { type: 'string', enum: ['click', 'type', 'look'] },
                },
                required: ['target', 'say', 'action'],
              },
            },
            note: { type: 'string' },
          },
          required: ['title', 'steps'],
        },
      });
      return parseGuide(res.text ?? '', ids);
    });
    return { ...value, cached, usage: await this.deps.budget.usage(userId) };
  }
}

/** Validates Gemini's JSON: unknown targets dropped, at most 7 steps; nothing usable is an error. */
export function parseGuide(text: string, ids: string[]): Omit<GuideResult, 'cached' | 'usage'> {
  let raw: unknown;
  try {
    raw = JSON.parse(text.replace(/^```(?:json)?\s*|\s*```$/g, ''));
  } catch {
    throw new CopilotError(502, 'The guide could not be read. Try asking again.');
  }
  const parsed = guideOutput.safeParse(raw);
  if (!parsed.success) throw new CopilotError(502, 'The guide could not be read. Try asking again.');
  const allowed = new Set(ids);
  const steps = parsed.data.steps.filter((s) => allowed.has(s.target)).slice(0, 7);
  const note = parsed.data.note?.trim() || null;
  if (!steps.length && !note) throw new CopilotError(502, "Couldn't work out the steps for that. Try rephrasing the question.");
  return { title: parsed.data.title, steps, note };
}

function toolContext(get: ApiGet): ToolContext {
  return { get, viewBbox: null, actions: [], ships: new Map() };
}
