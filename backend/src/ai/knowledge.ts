import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Redis } from 'ioredis';

/**
 * Knowledge base for the copilot (RAG). Reference notes live in backend/knowledge/*.md; each
 * "## " section is one chunk. Chunks are stored in knowledge_chunks with a Gemini embedding and a
 * full-text index, and searched both ways at once (hybrid search):
 *
 *   keyword  Postgres full-text rank: exact terms such as "status 5", "MID 563", "Rule 15"
 *   vector   cosine distance between embeddings: questions worded differently from the notes
 *
 * The two ranked lists are merged with Reciprocal Rank Fusion (score = sum of 1 / (60 + rank)),
 * which needs no tuning between the two very different score scales. Without embeddings (no API
 * key, or the embedding call failed) search falls back to keywords alone.
 */

export interface Chunk {
  source: string;
  title: string;
  body: string;
  hash: string;
}

export interface Embedder {
  /** model@dimensions: stored with each embedding, so a model change re-embeds everything. */
  model: string;
  dims: number;
  /** Vector matches further than this (cosine distance) are about something else; depends on the model. */
  maxDistance: number;
  embed(texts: string[], kind: 'document' | 'query'): Promise<number[][]>;
}

export interface KnowledgeHit {
  source: string;
  title: string;
  text: string;
  score: number;
  matched_by: ('keyword' | 'vector')[];
}

/** Runs SQL (pool.query or a client's query). */
export type Query = (sql: string, params?: unknown[]) => Promise<{ rows: unknown[] }>;
const rowsOf = async <R>(q: Query, sql: string, params?: unknown[]) => (await q(sql, params)).rows as R[];

const here = path.dirname(fileURLToPath(import.meta.url));
// Works from src/ai (tsx) and dist/ai (compiled): knowledge/ sits at the package root.
export const KNOWLEDGE_DIR = path.resolve(here, '..', '..', 'knowledge');

const RRF_K = 60;
const CANDIDATES = 20;

const sha = (s: string) => createHash('sha256').update(s).digest('hex');

/** Splits a note into its "## " sections; the chunk title is "<document title>: <section>". */
export function chunkMarkdown(source: string, md: string): Chunk[] {
  const doc = md.match(/^# (.+)$/m)?.[1]?.trim() ?? source.replace(/\.md$/, '');
  return md
    .split(/^## /m)
    .slice(1)
    .map((section) => {
      const [heading = '', ...rest] = section.split('\n');
      const title = `${doc}: ${heading.trim()}`;
      const body = rest.join('\n').trim().replace(/\n{3,}/g, '\n\n');
      return { source, title, body, hash: sha(`${title}\n${body}`) };
    })
    .filter((c) => c.body);
}

export async function loadCorpus(dir = KNOWLEDGE_DIR): Promise<Chunk[]> {
  const files = (await readdir(dir)).filter((f) => f.endsWith('.md')).sort();
  const chunks = (await Promise.all(files.map(async (f) => chunkMarkdown(f, await readFile(path.join(dir, f), 'utf8'))))).flat();
  const seen = new Set<string>();
  for (const c of chunks) {
    const key = `${c.source}\u0000${c.title}`;
    if (seen.has(key)) throw new Error(`knowledge: duplicate section "${c.title}" in ${c.source}`);
    seen.add(key);
  }
  return chunks;
}

const vectorLiteral = (v: number[]) => `[${v.map((x) => (Number.isFinite(x) ? x : 0)).join(',')}]`;

/**
 * Makes knowledge_chunks match the corpus: new and changed sections are written (changed ones lose
 * their embedding), removed ones deleted, then every chunk without an embedding from this model is
 * embedded. Returns what changed. Safe to run on every start: unchanged notes cost nothing.
 */
export async function syncKnowledge(query: Query, chunks: Chunk[], embedder: Embedder | null) {
  const rows = await rowsOf<{ source: string; title: string; content_hash: string }>(query, `SELECT source, title, content_hash FROM knowledge_chunks`);
  const existing = new Map(rows.map((r) => [`${r.source}\u0000${r.title}`, r.content_hash]));
  const changed = chunks.filter((c) => existing.get(`${c.source}\u0000${c.title}`) !== c.hash);
  if (changed.length) {
    await query(
      `INSERT INTO knowledge_chunks (source, title, body, content_hash)
       SELECT source, title, body, hash FROM jsonb_to_recordset($1::jsonb) AS r(source text, title text, body text, hash text)
       ON CONFLICT (source, title) DO UPDATE SET body = EXCLUDED.body, content_hash = EXCLUDED.content_hash,
         embedding = NULL, embed_model = NULL, updated_at = now()`,
      [JSON.stringify(changed)],
    );
  }
  const keep = new Set(chunks.map((c) => `${c.source}\u0000${c.title}`));
  const gone = rows.filter((r) => !keep.has(`${r.source}\u0000${r.title}`));
  if (gone.length) {
    await query(`DELETE FROM knowledge_chunks k USING jsonb_to_recordset($1::jsonb) AS g(source text, title text) WHERE k.source = g.source AND k.title = g.title`, [
      JSON.stringify(gone.map((g) => ({ source: g.source, title: g.title }))),
    ]);
  }
  let embedded = 0;
  if (embedder) {
    const todo = await rowsOf<{ id: string; title: string; body: string }>(
      query,
      `SELECT id::text, title, body FROM knowledge_chunks WHERE embedding IS NULL OR embed_model IS DISTINCT FROM $1 ORDER BY id`,
      [embedder.model],
    );
    for (let i = 0; i < todo.length; i += 50) {
      const batch = todo.slice(i, i + 50);
      const vectors = await embedder.embed(batch.map((c) => `${c.title}\n\n${c.body}`), 'document');
      await query(
        `UPDATE knowledge_chunks k SET embedding = r.embedding::vector, embed_model = $2
         FROM jsonb_to_recordset($1::jsonb) AS r(id bigint, embedding text) WHERE k.id = r.id`,
        [JSON.stringify(batch.map((c, j) => ({ id: Number(c.id), embedding: vectorLiteral(vectors[j]!) }))), embedder.model],
      );
      embedded += batch.length;
    }
  }
  return { chunks: chunks.length, written: changed.length, removed: gone.length, embedded };
}

/** "what does status 5 mean?" -> 'what | does | status | 5 | mean' OR-query (Postgres drops stop words and stems). */
export function keywordQuery(text: string): string {
  const words = text.toLowerCase().match(/[a-z0-9]+/g) ?? [];
  return [...new Set(words)].slice(0, 24).join(' | ');
}

/**
 * The codes in a question ('563', '15', '9300001') as an OR-query. Full-text rank has no notion of
 * how rare a term is, and fusion favours sections both searches like, so an exact code would lose
 * to a section that merely talks about the same topic. Here a code is the most specific thing a
 * question holds (a MID, a ship type, a rule number): sections containing it come first, ordered by
 * the fused score among themselves. Single digits are too common to count.
 */
export function numberQuery(text: string): string {
  return [...new Set(text.match(/\b\d{2,9}\b/g) ?? [])].slice(0, 8).join(' | ');
}

export class KnowledgeBase {
  constructor(
    private readonly deps: { query: Query; embedder: Embedder | null; redis?: Redis; cachePrefix?: string },
  ) {}

  /** The query's embedding (cached a week: the same questions come back), or null without an embedder. */
  private async queryVector(text: string): Promise<number[] | null> {
    const { embedder, redis, cachePrefix } = this.deps;
    if (!embedder) return null;
    const key = `${cachePrefix ?? 'ais'}:kb:q:${embedder.model}:${sha(text.trim().toLowerCase()).slice(0, 32)}`;
    const hit = await redis?.get(key);
    if (hit) return JSON.parse(hit) as number[];
    try {
      const [v] = await embedder.embed([text], 'query');
      if (!v) return null;
      await redis?.set(key, JSON.stringify(v), 'EX', 7 * 86_400);
      return v;
    } catch {
      return null; // keyword search still answers
    }
  }

  async search(text: string, k = 4): Promise<{ mode: 'hybrid' | 'keyword'; results: KnowledgeHit[] }> {
    const vector = await this.queryVector(text);
    const rows = await rowsOf<{ source: string; title: string; body: string; score: number; kw: number | null; vec: number | null }>(
      this.deps.query,
      `WITH kw AS (
         SELECT id, row_number() OVER (ORDER BY rank DESC) AS r FROM (
           SELECT id, ts_rank_cd(tsv, q) AS rank
           FROM knowledge_chunks, to_tsquery('english', $1) q
           WHERE $1 <> '' AND tsv @@ q
           ORDER BY rank DESC LIMIT ${CANDIDATES}) s
       ),
       vec AS (
         SELECT id, row_number() OVER (ORDER BY dist) AS r FROM (
           SELECT id, embedding <=> $2::vector AS dist
           FROM knowledge_chunks
           WHERE $2::vector IS NOT NULL AND embedding IS NOT NULL
           ORDER BY embedding <=> $2::vector LIMIT ${CANDIDATES}) s
         WHERE dist <= $4
       )
       SELECT c.source, c.title, c.body,
              (COALESCE(1.0 / (${RRF_K} + kw.r), 0) + COALESCE(1.0 / (${RRF_K} + vec.r), 0))::float8 AS score,
              kw.r::int AS kw, vec.r::int AS vec,
              ($5 <> '' AND c.tsv @@ to_tsquery('simple', $5)) AS exact
       FROM knowledge_chunks c
       LEFT JOIN kw ON kw.id = c.id
       LEFT JOIN vec ON vec.id = c.id
       WHERE kw.id IS NOT NULL OR vec.id IS NOT NULL
       ORDER BY exact DESC, score DESC, c.id
       LIMIT $3`,
      [keywordQuery(text), vector ? vectorLiteral(vector) : null, k, this.deps.embedder?.maxDistance ?? 1, numberQuery(text)],
    );
    return {
      mode: vector ? 'hybrid' : 'keyword',
      results: rows.map((r) => ({
        source: r.source,
        title: r.title,
        text: r.body.length > 900 ? `${r.body.slice(0, 899)}…` : r.body,
        score: Math.round(r.score * 10_000) / 10_000,
        matched_by: [...(r.kw ? (['keyword'] as const) : []), ...(r.vec ? (['vector'] as const) : [])],
      })),
    };
  }
}
