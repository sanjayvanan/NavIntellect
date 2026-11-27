-- AI observability: one row per Gemini request (or per answer served from the cache).
-- Rows of one question share run_id, so a copilot answer's tool rounds read as one trace.
-- Small on purpose (500 MB database): tool arguments are trimmed, no prompts or replies are kept.
-- Pruned after AI_TRACE_RETENTION_DAYS by the maintenance job.
CREATE TABLE ai_requests (
  id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  run_id          uuid NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  user_id         uuid REFERENCES users (id) ON DELETE SET NULL,
  feature         text NOT NULL,          -- copilot | brief | alert | guide | eval
  model           text NOT NULL,
  prompt_version  text NOT NULL,          -- hash of the system prompt (+ tool declarations)
  round           smallint NOT NULL,      -- 0-based tool round within the run
  outcome         text NOT NULL CHECK (outcome IN ('answer', 'tool_calls', 'cache_hit', 'error')),
  error           text,
  latency_ms      integer NOT NULL DEFAULT 0,
  ttft_ms         integer,                -- time to the first streamed text (streamed answers only)
  prompt_tokens   integer NOT NULL DEFAULT 0,
  output_tokens   integer NOT NULL DEFAULT 0,  -- includes thinking tokens
  cost_usd        numeric(12, 8) NOT NULL DEFAULT 0, -- at list price (the free tier is billed $0)
  tool_calls      jsonb NOT NULL DEFAULT '[]'      -- [{ name, args, ok, ms, error? }]
);
CREATE INDEX ai_requests_created ON ai_requests (created_at);
CREATE INDEX ai_requests_run ON ai_requests (run_id);
