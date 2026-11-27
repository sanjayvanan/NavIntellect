-- Knowledge base for the copilot (retrieval-augmented generation): short reference notes from
-- backend/knowledge/*.md, one row per section, searched two ways and merged (hybrid search):
--   embedding  meaning (pgvector, cosine distance, HNSW index)
--   tsv        exact words (Postgres full-text search), which also works when no embeddings exist
-- A few dozen rows of 768 floats: well under 1 MB, nothing for the 500 MB plan.
CREATE EXTENSION IF NOT EXISTS vector WITH SCHEMA extensions;

CREATE TABLE knowledge_chunks (
  id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  source        text NOT NULL,           -- file name, e.g. mmsi.md
  title         text NOT NULL,           -- "MMSI numbers: Common flag MIDs"
  body          text NOT NULL,
  content_hash  text NOT NULL,           -- re-embedded only when this changes
  embedding     vector(768),
  embed_model   text,                    -- model@dimensions the embedding was made with
  tsv           tsvector GENERATED ALWAYS AS (
                  setweight(to_tsvector('english', title), 'A') || setweight(to_tsvector('english', body), 'B')) STORED,
  updated_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (source, title)
);
CREATE INDEX knowledge_chunks_embedding ON knowledge_chunks USING hnsw (embedding vector_cosine_ops);
CREATE INDEX knowledge_chunks_tsv ON knowledge_chunks USING gin (tsv);
