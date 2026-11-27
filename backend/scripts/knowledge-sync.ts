import { loadCorpus, syncKnowledge } from '../src/ai/knowledge.js';
import { knowledgeEmbedder } from '../src/api/server.js';
import { pool } from '../src/db/pool.js';

/**
 * npm run knowledge:sync — loads backend/knowledge/*.md into knowledge_chunks and embeds what
 * changed. The API also does this on start; run it by hand after editing the notes.
 */
const embedder = knowledgeEmbedder();
const r = await syncKnowledge((sql, params) => pool.query(sql, params), await loadCorpus(), embedder);
console.log({ ...r, embeddings: embedder ? embedder.model : 'none (no GEMINI_API_KEY): keyword search only' });
await pool.end();
