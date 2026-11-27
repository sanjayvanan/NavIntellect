import type { MapAction } from '../src/ai/tools.js';

/**
 * Scoring for copilot evals. A case lists what a good answer must do: the tools it must call
 * (with the key arguments), the map actions it must produce, and facts the reply must state.
 * Every expectation is one check; a case passes when all its checks pass. No LLM judge: it would
 * spend the same small free quota, and these checks are exact and repeatable.
 */

/** A literal (strings: case-insensitive, contained), a RegExp, or a predicate. */
export type Matcher = string | number | boolean | RegExp | ((v: unknown) => boolean);

export interface ToolExpect {
  name: string;
  args?: Record<string, Matcher>;
}

export interface ActionExpect {
  type: MapAction['type'];
  [field: string]: Matcher;
}

export interface Expect {
  /** Each entry must be satisfied by some call; an inner array means "any one of these". */
  tools?: (ToolExpect | ToolExpect[])[];
  /** None of these tools may be called. */
  forbidTools?: string[];
  /** Each entry must be matched by some map action; an inner array means "any one of these". */
  actions?: (ActionExpect | ActionExpect[])[];
  /** No map action at all (e.g. the user only asked a question, or the data tried to make one). */
  noActions?: boolean;
  /** Only these action types may appear. */
  onlyActions?: MapAction['type'][];
  reply?: {
    /** All must appear. */
    all?: Matcher[];
    /** At least one must appear. */
    any?: Matcher[];
    /** None may appear. */
    none?: Matcher[];
  };
  /** At most this many Gemini requests (tool rounds + the answer). */
  maxRequests?: number;
  /** Extra check over the whole run; returns a failure message or null. */
  custom?: { name: string; check: (run: RunRecord) => string | null };
}

export interface EvalCase {
  id: string;
  category: 'search' | 'details' | 'track' | 'zones_alerts' | 'actions' | 'grounding' | 'multi_turn' | 'injection' | 'knowledge';
  /** The conversation; the last message is the question. */
  messages: { role: 'user' | 'assistant'; text: string }[];
  context?: { bbox?: [number, number, number, number]; zoom?: number; selected?: { mmsi: number; name?: string } };
  expect: Expect;
}

export interface ToolCallRecord {
  name: string;
  args: Record<string, unknown>;
  /** What the tool returned to the model ({ result } or { error }). */
  response?: Record<string, unknown>;
}

export interface RunRecord {
  reply: string;
  actions: MapAction[];
  calls: ToolCallRecord[];
  requests: number;
}

export interface CheckResult {
  check: string;
  pass: boolean;
  detail?: string;
}

export function matches(m: Matcher, v: unknown): boolean {
  if (typeof m === 'function') return m(v);
  if (m instanceof RegExp) return typeof v === 'string' || typeof v === 'number' ? m.test(String(v)) : false;
  if (typeof m === 'string') return (typeof v === 'string' || typeof v === 'number') && String(v).toLowerCase().includes(m.toLowerCase());
  if (typeof m === 'number') return Number(v) === m;
  return v === m;
}

const show = (m: Matcher) => (typeof m === 'function' ? (m.name || 'predicate') : String(m));

/** Matchers for common argument shapes. */
export const M = {
  /** A number in [lo, hi]. */
  between: (lo: number, hi: number) => Object.defineProperty((v: unknown) => Number.isFinite(Number(v)) && Number(v) >= lo && Number(v) <= hi, 'name', { value: `between(${lo},${hi})` }) as (v: unknown) => boolean,
  /** A [minLon, minLat, maxLon, maxLat] box that contains the point and is not absurdly large. */
  bboxAround: (lon: number, lat: number, maxSpanDeg = 30) =>
    Object.defineProperty(
      (v: unknown) => {
        if (!Array.isArray(v) || v.length !== 4) return false;
        const [w, s, e, n] = v.map(Number) as [number, number, number, number];
        const lonOk = w <= e ? lon >= w && lon <= e : lon >= w || lon <= e;
        return lonOk && lat >= s && lat <= n && n - s <= maxSpanDeg;
      },
      'name',
      { value: `bboxAround(${lon},${lat})` },
    ) as (v: unknown) => boolean,
  /** A whole-number match that tolerates "563001001" vs 563001001. */
  int: (n: number) => Object.defineProperty((v: unknown) => Number(v) === n, 'name', { value: String(n) }) as (v: unknown) => boolean,
};

function toolSatisfied(e: ToolExpect, calls: ToolCallRecord[]) {
  return calls.some((c) => c.name === e.name && Object.entries(e.args ?? {}).every(([k, m]) => matches(m, c.args[k])));
}

function actionSatisfied(e: ActionExpect, actions: MapAction[]) {
  return actions.some((a) => a.type === e.type && Object.entries(e).every(([k, m]) => k === 'type' || matches(m, (a as Record<string, unknown>)[k])));
}

const describeTool = (e: ToolExpect) => `${e.name}(${Object.entries(e.args ?? {}).map(([k, m]) => `${k}=${show(m)}`).join(', ')})`;
const describeAction = (e: ActionExpect) => `${e.type}(${Object.entries(e).filter(([k]) => k !== 'type').map(([k, m]) => `${k}=${show(m)}`).join(', ')})`;

export function score(c: EvalCase, run: RunRecord): CheckResult[] {
  const out: CheckResult[] = [];
  const x = c.expect;
  const calls = run.calls.map((k) => `${k.name}(${JSON.stringify(k.args)})`).join('; ') || 'none';

  for (const t of x.tools ?? []) {
    const alts = Array.isArray(t) ? t : [t];
    const name = `tool: ${alts.map(describeTool).join(' | ')}`;
    out.push({ check: name, pass: alts.some((a) => toolSatisfied(a, run.calls)), detail: `called: ${calls}` });
  }
  for (const f of x.forbidTools ?? []) {
    out.push({ check: `no tool ${f}`, pass: !run.calls.some((k) => k.name === f), detail: `called: ${calls}` });
  }
  const acts = JSON.stringify(run.actions);
  for (const a of x.actions ?? []) {
    const alts = Array.isArray(a) ? a : [a];
    out.push({ check: `action: ${alts.map(describeAction).join(' | ')}`, pass: alts.some((e) => actionSatisfied(e, run.actions)), detail: `actions: ${acts}` });
  }
  if (x.noActions) out.push({ check: 'no map actions', pass: run.actions.length === 0, detail: `actions: ${acts}` });
  if (x.onlyActions) {
    const bad = run.actions.filter((a) => !x.onlyActions!.includes(a.type));
    out.push({ check: `only actions ${x.onlyActions.join(',')}`, pass: bad.length === 0, detail: `actions: ${acts}` });
  }
  const r = x.reply;
  const said = `reply: ${run.reply.slice(0, 300)}`;
  for (const m of r?.all ?? []) out.push({ check: `reply has ${show(m)}`, pass: matches(m, run.reply), detail: said });
  if (r?.any?.length) out.push({ check: `reply has one of ${r.any.map(show).join(' / ')}`, pass: r.any.some((m) => matches(m, run.reply)), detail: said });
  for (const m of r?.none ?? []) out.push({ check: `reply lacks ${show(m)}`, pass: !matches(m, run.reply), detail: said });
  if (x.maxRequests !== undefined) {
    out.push({ check: `at most ${x.maxRequests} requests`, pass: run.requests <= x.maxRequests, detail: `requests: ${run.requests}` });
  }
  if (x.custom) {
    const fail = x.custom.check(run);
    out.push({ check: x.custom.name, pass: fail === null, ...(fail ? { detail: fail } : {}) });
  }
  return out;
}

/** The tool result the model saw for the first call of this tool (or undefined). */
export function toolResult<T = Record<string, unknown>>(run: RunRecord, name: string): T | undefined {
  return run.calls.find((c) => c.name === name && c.response && 'result' in c.response)?.response?.result as T | undefined;
}
