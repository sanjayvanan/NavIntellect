import type { FastifyInstance } from 'fastify';
import type { Redis } from 'ioredis';
import { z } from 'zod';
import { KnowledgeBase, type Embedder } from '../../ai/knowledge.js';
import { config } from '../../config.js';
import { pool } from '../../db/pool.js';
import { requireRole } from '../auth/guard.js';
import { parse } from '../errors.js';

const searchQuery = z.object({
  q: z.string().trim().min(2).max(300),
  k: z.coerce.number().int().min(1).max(8).default(4),
});

/**
 * Knowledge base search (the copilot's search_knowledge tool calls this, like its other tools).
 *   GET /api/knowledge/search?q=&k=  -> { mode: 'hybrid' | 'keyword', results: [{ source, title, text, score, matched_by }] }
 * Signed-in users only: a question may cost one embedding request.
 */
export async function knowledgeRoutes(app: FastifyInstance, opts: { redis: Redis; embedder: Embedder | null }) {
  const kb = new KnowledgeBase({ query: (sql, params) => pool.query(sql, params), embedder: opts.embedder, redis: opts.redis, cachePrefix: config.DB_SCHEMA });
  app.get('/api/knowledge/search', { preHandler: requireRole('viewer') }, async (req) => {
    const { q, k } = parse(searchQuery, req.query);
    return kb.search(q, k);
  });
}
