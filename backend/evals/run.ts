import { appendFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import type { Content } from '@google/genai';
import { AiBudget } from '../src/ai/budget.js';
import { Copilot, COPILOT_PROMPT_VERSION, CopilotError, type ModelClient } from '../src/ai/copilot.js';
import { geminiClient } from '../src/ai/gemini.js';
import { AiTracer, memoryTraceSink } from '../src/ai/trace.js';
import { config } from '../src/config.js';
import { createRedis } from '../src/shared/redis.js';
import { CASES } from './cases.js';
import { score, type CheckResult, type EvalCase, type RunRecord, type ToolCallRecord } from './score.js';
import { ship, worldApi, ZONES } from './world.js';

/**
 * Copilot evals against the real Gemini API and the fixed world in evals/world.ts.
 *
 *   npm run eval -- --dry-run                 check the cases, estimate requests, show the budget left
 *   npm run eval                              run every case with GEMINI_MODEL
 *   npm run eval -- --model gemini-x --category injection --limit 5
 *   npm run eval -- --cases search-by-name,track-show-6h
 *
 * Each run spends real free-tier requests: they are reserved in the app's own daily budget (Redis),
 * so an eval can never push the app over its quota. Results go to evals/results/<time>-<model>.json,
 * and one summary line per run to evals/results/history.jsonl (pass rate over time, per model and
 * prompt version).
 */

const here = path.dirname(fileURLToPath(import.meta.url));
const RESULTS = path.join(here, 'results');
const EST_REQUESTS_PER_CASE = 2.5;

const parseOptions = () =>
  parseArgs({
    options: {
    model: { type: 'string', default: config.GEMINI_MODEL },
    cases: { type: 'string' },
    category: { type: 'string' },
    limit: { type: 'string' },
    'dry-run': { type: 'boolean', default: false },
    force: { type: 'boolean', default: false },
    },
  }).values;
type Options = ReturnType<typeof parseOptions>;

function selectCases(opt: Options): EvalCase[] {
  let list = CASES;
  if (opt.cases) {
    const ids = new Set(opt.cases.split(',').map((s) => s.trim()));
    const unknown = [...ids].filter((id) => !CASES.some((c) => c.id === id));
    if (unknown.length) throw new Error(`unknown case ids: ${unknown.join(', ')}`);
    list = list.filter((c) => ids.has(c.id));
  }
  if (opt.category) list = list.filter((c) => c.category === opt.category);
  if (opt.limit) list = list.slice(0, Number(opt.limit));
  return list;
}

/** Static checks: unique ids, MMSIs and zone ids that exist in the world. */
export function validateCases(cases: EvalCase[]): string[] {
  const problems: string[] = [];
  const seen = new Set<string>();
  for (const c of cases) {
    if (seen.has(c.id)) problems.push(`${c.id}: duplicate id`);
    seen.add(c.id);
    if (c.messages[c.messages.length - 1]?.role !== 'user') problems.push(`${c.id}: last message must be the user's`);
    const text = JSON.stringify(c, (_k, v) => (v instanceof RegExp || typeof v === 'function' ? undefined : v));
    for (const m of text.match(/\b\d{9}\b/g) ?? []) if (!ship(Number(m))) problems.push(`${c.id}: MMSI ${m} is not in the world`);
    if (c.context?.selected && !ship(c.context.selected.mmsi)) problems.push(`${c.id}: selected ship not in the world`);
  }
  if (ZONES.length !== new Set(ZONES.map((z) => z.id)).size) problems.push('world: duplicate zone ids');
  return problems;
}

/** Tool calls and what each returned, read from the conversation the model was sent last. */
export function callsFrom(contents: Content[] | undefined): ToolCallRecord[] {
  const out: ToolCallRecord[] = [];
  let pending: ToolCallRecord[] = [];
  for (const c of contents ?? []) {
    const calls = (c.parts ?? []).flatMap((p) => (p.functionCall ? [p.functionCall] : []));
    const responses = (c.parts ?? []).flatMap((p) => (p.functionResponse ? [p.functionResponse] : []));
    if (calls.length) {
      pending = calls.map((f) => ({ name: f.name ?? '?', args: (f.args ?? {}) as Record<string, unknown> }));
      out.push(...pending);
    }
    responses.forEach((r, i) => {
      const target = pending.find((p) => p.name === r.name && !p.response) ?? pending[i];
      if (target) target.response = r.response as Record<string, unknown>;
    });
  }
  return out;
}

const sleep = (s: number) => new Promise((r) => setTimeout(r, s * 1000));

interface CaseResult {
  id: string;
  category: string;
  pass: boolean;
  checks: CheckResult[];
  reply?: string;
  actions?: unknown[];
  calls?: { name: string; args: unknown; error?: unknown }[];
  requests: number;
  latency_ms: number;
  prompt_tokens: number;
  output_tokens: number;
  error?: string;
}

async function main() {
  const opt = parseOptions();
  const cases = selectCases(opt);
  const problems = validateCases(CASES);
  if (problems.length) {
    console.error(`Case problems:\n  ${problems.join('\n  ')}`);
    process.exit(1);
  }
  const redis = createRedis('eval');
  const budget = new AiBudget(redis, config.DB_SCHEMA, { daily: config.AI_DAILY_LIMIT, userDaily: config.AI_DAILY_LIMIT, perMinute: config.AI_RPM });
  const usage = await budget.usage('eval');
  const left = usage.limit_today - usage.used_today;
  const estimate = Math.ceil(cases.length * EST_REQUESTS_PER_CASE);
  console.log(`${cases.length} cases, model ${opt.model}, prompt ${COPILOT_PROMPT_VERSION}`);
  console.log(`Estimated Gemini requests: ~${estimate} (up to ${cases.length * (config.AI_MAX_TOOL_ROUNDS + 1)}). Budget left today: ${left}/${usage.limit_today}.`);

  if (opt['dry-run']) {
    console.log('Dry run: cases are valid. Nothing was sent to Gemini.');
    await redis.quit();
    return;
  }
  if (!config.GEMINI_API_KEY) throw new Error('GEMINI_API_KEY is not set (backend/.env).');
  if (estimate > left && !opt.force) {
    console.error('Not enough budget left today for this run. Use --limit/--category, wait for the reset, or pass --force.');
    await redis.quit();
    process.exit(1);
  }

  const sink = memoryTraceSink();
  const tracer = new AiTracer(sink, { model: opt.model!, prices: { inputPerM: config.AI_PRICE_INPUT_PER_M, outputPerM: config.AI_PRICE_OUTPUT_PER_M } });
  let lastContents: Content[] | undefined;
  const gemini = geminiClient(config.GEMINI_API_KEY, opt.model!);
  const model: ModelClient = {
    generate: (req) => {
      lastContents = req.contents;
      return gemini.generate(req);
    },
  };
  const runId = new Date().toISOString().replace(/[:.]/g, '-');
  const copilot = new Copilot({ model, budget, tracer, redis, cachePrefix: `eval-${runId}`, maxToolRounds: config.AI_MAX_TOOL_ROUNDS });
  const get = worldApi();

  const results: CaseResult[] = [];
  let stopped = '';
  for (const [i, c] of cases.entries()) {
    if (stopped) break;
    for (let attempt = 0; ; attempt++) {
      lastContents = undefined;
      const before = sink.rows.length;
      const t0 = performance.now();
      try {
        const res = await copilot.ask({ userId: 'eval', messages: c.messages, context: c.context ?? {}, get });
        const rows = sink.rows.slice(before);
        const run: RunRecord = { reply: res.reply, actions: res.actions, calls: callsFrom(lastContents), requests: res.requests };
        const checks = score(c, run);
        results.push({
          id: c.id, category: c.category, pass: checks.every((k) => k.pass), checks, reply: res.reply, actions: res.actions,
          calls: run.calls.map((k) => ({ name: k.name, args: k.args, ...(k.response?.error ? { error: k.response.error } : {}) })),
          requests: res.requests, latency_ms: Math.round(performance.now() - t0),
          prompt_tokens: rows.reduce((s, r) => s + r.prompt_tokens, 0), output_tokens: rows.reduce((s, r) => s + r.output_tokens, 0),
        });
        break;
      } catch (err) {
        const retryable = err instanceof CopilotError && (err.status === 429 || err.status === 503 || err.status === 504);
        const daily = err instanceof CopilotError && err.status === 429 && (err.retryAfter ?? 0) > 120;
        if (retryable && !daily && attempt < 2) {
          const wait = Math.min(65, (err as CopilotError).retryAfter ?? 30) + 2;
          console.log(`  ${c.id}: ${(err as Error).message} Waiting ${wait}s...`);
          await sleep(wait);
          continue;
        }
        if (daily) stopped = (err as Error).message;
        results.push({
          id: c.id, category: c.category, pass: false, checks: [], requests: 0, latency_ms: Math.round(performance.now() - t0),
          prompt_tokens: 0, output_tokens: 0, error: (err as Error).message,
        });
        break;
      }
    }
    const r = results[results.length - 1]!;
    const failed = r.checks.filter((k) => !k.pass);
    console.log(`${String(i + 1).padStart(2)}/${cases.length} ${r.pass ? 'PASS' : 'FAIL'} ${c.id}${r.error ? ` (error: ${r.error})` : ''}`);
    for (const f of failed) console.log(`        ✗ ${f.check}${f.detail ? `\n          ${f.detail}` : ''}`);
  }
  await redis.quit();

  const ran = results.filter((r) => !r.error);
  const byCategory: Record<string, { pass: number; total: number }> = {};
  for (const r of results) {
    const b = (byCategory[r.category] ??= { pass: 0, total: 0 });
    b.total++;
    if (r.pass) b.pass++;
  }
  const lat = ran.map((r) => r.latency_ms).sort((a, b) => a - b);
  const pct = (p: number) => lat[Math.min(lat.length - 1, Math.floor(p * lat.length))] ?? 0;
  const tokensIn = sink.rows.reduce((s, r) => s + r.prompt_tokens, 0);
  const tokensOut = sink.rows.reduce((s, r) => s + r.output_tokens, 0);
  const summary = {
    run: runId,
    model: opt.model,
    prompt_version: COPILOT_PROMPT_VERSION,
    cases: results.length,
    passed: results.filter((r) => r.pass).length,
    errors: results.length - ran.length,
    pass_rate: results.length ? +(results.filter((r) => r.pass).length / results.length).toFixed(3) : 0,
    checks_pass_rate: +(results.flatMap((r) => r.checks).filter((k) => k.pass).length / Math.max(1, results.flatMap((r) => r.checks).length)).toFixed(3),
    by_category: byCategory,
    requests: sink.rows.length,
    avg_requests_per_case: +(sink.rows.length / Math.max(1, ran.length)).toFixed(2),
    p50_ms: pct(0.5),
    p95_ms: pct(0.95),
    prompt_tokens: tokensIn,
    output_tokens: tokensOut,
    cost_usd_list_price: +sink.rows.reduce((s, r) => s + r.cost_usd, 0).toFixed(6),
    ...(stopped ? { stopped_early: stopped } : {}),
    ...(opt.cases || opt.category || opt.limit ? { subset: { cases: opt.cases, category: opt.category, limit: opt.limit } } : {}),
  };

  await mkdir(RESULTS, { recursive: true });
  const file = path.join(RESULTS, `${runId}-${opt.model!.replace(/[^\w.-]/g, '_')}.json`);
  await writeFile(file, JSON.stringify({ summary, results }, null, 2));
  const historyFile = path.join(RESULTS, 'history.jsonl');
  const previous = (await readFile(historyFile, 'utf8').catch(() => ''))
    .split('\n')
    .filter(Boolean)
    .map((l) => JSON.parse(l) as typeof summary)
    .filter((h) => h.model === summary.model && !h.subset && !summary.subset)
    .pop();
  await appendFile(historyFile, JSON.stringify(summary) + '\n');

  console.log('\nCategory        pass');
  for (const [k, v] of Object.entries(byCategory)) console.log(`${k.padEnd(15)} ${v.pass}/${v.total}`);
  console.log(
    `\nPassed ${summary.passed}/${summary.cases} (${(summary.pass_rate * 100).toFixed(1)}%), checks ${(summary.checks_pass_rate * 100).toFixed(1)}%` +
      `, ${summary.requests} requests (${summary.avg_requests_per_case}/case), p50 ${summary.p50_ms} ms, p95 ${summary.p95_ms} ms` +
      `, ${tokensIn + tokensOut} tokens, $${summary.cost_usd_list_price} at list price.`,
  );
  if (previous) {
    const d = (summary.pass_rate - previous.pass_rate) * 100;
    console.log(`Change since the last full run of ${summary.model} (prompt ${previous.prompt_version}): ${d >= 0 ? '+' : ''}${d.toFixed(1)} points.`);
  }
  if (stopped) console.log(`Stopped early: ${stopped}`);
  console.log(`Results: ${path.relative(process.cwd(), file)}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
