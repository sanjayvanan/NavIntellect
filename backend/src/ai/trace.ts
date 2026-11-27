import { createHash, randomUUID } from 'node:crypto';
import { logger } from '../shared/logger.js';
import type { GenerateRequest, GenerateResult, ModelClient } from './copilot.js';

/**
 * AI observability. Every Gemini request becomes one row in ai_requests: feature, model, prompt
 * version, tool round, outcome, latency, tokens, cost at list price, and the tool calls it asked
 * for (with whether each one worked and how long it took). Answers served from the cache are
 * recorded too, so the cache-hit rate is measurable.
 *
 * A run is one question (one copilot answer, one briefing...). Its rows are kept in memory and
 * written in a single INSERT when the run ends: one database round trip per question, and a
 * failing trace write is logged, never shown to the user.
 */

export type Outcome = 'answer' | 'tool_calls' | 'cache_hit' | 'error';

export interface ToolTrace {
  name: string;
  args: unknown;
  ok?: boolean;
  ms?: number;
  error?: string;
}

export interface TraceRow {
  run_id: string;
  created_at: string;
  user_id: string | null;
  feature: string;
  model: string;
  prompt_version: string;
  round: number;
  outcome: Outcome;
  error: string | null;
  latency_ms: number;
  /** Streamed answers: milliseconds until the first text. */
  ttft_ms: number | null;
  prompt_tokens: number;
  output_tokens: number;
  cost_usd: number;
  tool_calls: ToolTrace[];
}

/** Where finished runs go (Postgres in the app, an array in tests and evals). */
export interface TraceSink {
  write(rows: TraceRow[]): Promise<void>;
}

export interface Prices {
  /** US dollars per million input tokens. */
  inputPerM: number;
  /** US dollars per million output tokens (thinking included). */
  outputPerM: number;
}

/** Short stable id of a prompt: it changes whenever the prompt (or the tool list) changes. */
export const promptVersion = (...parts: unknown[]) =>
  createHash('sha256').update(parts.map((p) => (typeof p === 'string' ? p : JSON.stringify(p))).join('\n\u0000\n')).digest('hex').slice(0, 10);

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_ARGS_CHARS = 300;

/** Tool arguments as stored: whole when small, otherwise a trimmed string. */
function trimArgs(args: unknown): unknown {
  const s = JSON.stringify(args ?? {});
  return s.length <= MAX_ARGS_CHARS ? (args ?? {}) : { truncated: s.slice(0, MAX_ARGS_CHARS) };
}

export class AiTracer {
  constructor(
    private readonly sink: TraceSink,
    private readonly opts: { model: string; prices: Prices },
  ) {}

  run(meta: { feature: string; userId: string | null; promptVersion: string; model?: string }) {
    return new TraceRun(this.sink, { ...meta, model: meta.model ?? this.opts.model }, this.opts.prices);
  }
}

export class TraceRun {
  readonly id = randomUUID();
  readonly rows: TraceRow[] = [];
  private finished = false;

  constructor(
    private readonly sink: TraceSink,
    private readonly meta: { feature: string; userId: string | null; promptVersion: string; model: string },
    private readonly prices: Prices,
  ) {}

  private row(round: number, fields: Partial<TraceRow> & { outcome: Outcome }): TraceRow {
    const row: TraceRow = {
      run_id: this.id,
      created_at: new Date().toISOString(),
      user_id: this.meta.userId && UUID.test(this.meta.userId) ? this.meta.userId : null,
      feature: this.meta.feature,
      model: this.meta.model,
      prompt_version: this.meta.promptVersion,
      round,
      error: null,
      latency_ms: 0,
      ttft_ms: null,
      prompt_tokens: 0,
      output_tokens: 0,
      cost_usd: 0,
      tool_calls: [],
      ...fields,
    };
    this.rows.push(row);
    return row;
  }

  /** The model, measured: each generate() call adds a row (also when it throws). */
  wrap(model: ModelClient): ModelClient {
    const measure = async (req: GenerateRequest, call: (firstText: () => void) => Promise<GenerateResult>) => {
      const round = this.rows.length;
      const t0 = performance.now();
      let ttft: number | null = null;
      const firstText = () => {
        ttft ??= Math.round(performance.now() - t0);
      };
      try {
        const res = await call(firstText);
        const prompt = res.usage?.prompt ?? 0;
        const output = res.usage?.output ?? Math.max(0, (res.tokens ?? 0) - prompt);
        const calls = req.allowTools && req.tools !== false ? (res.functionCalls ?? []) : [];
        this.row(round, {
          outcome: calls.length ? 'tool_calls' : 'answer',
          latency_ms: Math.round(performance.now() - t0),
          ttft_ms: ttft,
          prompt_tokens: prompt,
          output_tokens: output,
          cost_usd: (prompt * this.prices.inputPerM + output * this.prices.outputPerM) / 1e6,
          tool_calls: calls.map((c) => ({ name: c.name ?? '?', args: trimArgs(c.args) })),
        });
        return res;
      } catch (err) {
        this.row(round, {
          outcome: 'error',
          latency_ms: Math.round(performance.now() - t0),
          error: (err instanceof Error ? `${err.name}: ${err.message}` : String(err)).slice(0, 300),
        });
        throw err;
      }
    };
    return { generate: (req) => measure(req, () => model.generate(req)) };
  }

  /** Records how the i-th tool call asked for in the latest request went. */
  tool(i: number, result: Record<string, unknown>, ms: number) {
    const t = this.rows[this.rows.length - 1]?.tool_calls[i];
    if (!t) return;
    t.ok = !result.error;
    t.ms = Math.round(ms);
    if (result.error) t.error = String(result.error).slice(0, 200);
  }

  cacheHit() {
    this.row(0, { outcome: 'cache_hit' });
  }

  /** Writes the run's rows. Never throws: tracing must not break an answer. */
  async finish() {
    if (this.finished || !this.rows.length) return;
    this.finished = true;
    try {
      await this.sink.write(this.rows);
    } catch (err) {
      logger.warn({ err: (err as Error).message, run: this.id }, 'could not record AI trace');
    }
  }
}

/** Stores traces in ai_requests (one INSERT per run). */
export function pgTraceSink(query: (sql: string, params: unknown[]) => Promise<unknown>): TraceSink {
  return {
    async write(rows) {
      await query(
        `INSERT INTO ai_requests (run_id, created_at, user_id, feature, model, prompt_version, round, outcome, error,
                                  latency_ms, ttft_ms, prompt_tokens, output_tokens, cost_usd, tool_calls)
         SELECT run_id, created_at, user_id, feature, model, prompt_version, round, outcome, error,
                latency_ms, ttft_ms, prompt_tokens, output_tokens, cost_usd, tool_calls
         FROM jsonb_to_recordset($1::jsonb) AS r(
           run_id uuid, created_at timestamptz, user_id uuid, feature text, model text, prompt_version text,
           round smallint, outcome text, error text, latency_ms int, ttft_ms int, prompt_tokens int, output_tokens int,
           cost_usd numeric, tool_calls jsonb)`,
        [JSON.stringify(rows)],
      );
    },
  };
}

/** Keeps traces in memory (tests, evals). */
export function memoryTraceSink(): TraceSink & { rows: TraceRow[] } {
  const rows: TraceRow[] = [];
  return {
    rows,
    async write(r) {
      rows.push(...r);
    },
  };
}
