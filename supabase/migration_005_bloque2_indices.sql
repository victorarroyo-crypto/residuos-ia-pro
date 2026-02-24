-- ================================================================
-- BLOQUE 2: Índices (puede tardar unos segundos si hay datos)
-- Copiar y ejecutar en Supabase SQL Editor
-- ================================================================

-- Índices GIN para búsqueda full-text
CREATE INDEX IF NOT EXISTS idx_knowledge_chunks_tsv
  ON knowledge_chunks USING gin(tsv);

CREATE INDEX IF NOT EXISTS idx_project_chunks_tsv
  ON project_chunks USING gin(tsv);

-- Índices para deduplicación por hash
CREATE INDEX IF NOT EXISTS idx_knowledge_docs_hash
  ON knowledge_documents(content_hash) WHERE content_hash IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_project_docs_hash
  ON project_documents(content_hash) WHERE content_hash IS NOT NULL;

-- Índices HNSW tuneados (mejor recall para búsqueda vectorial)
-- M=24: más conexiones entre nodos = mejores resultados
-- ef_construction=200: mayor calidad al construir el índice
DROP INDEX IF EXISTS idx_knowledge_chunks_embedding;
CREATE INDEX idx_knowledge_chunks_embedding ON knowledge_chunks
  USING hnsw (embedding vector_cosine_ops)
  WITH (m = 24, ef_construction = 200);

DROP INDEX IF EXISTS idx_project_chunks_embedding;
CREATE INDEX idx_project_chunks_embedding ON project_chunks
  USING hnsw (embedding vector_cosine_ops)
  WITH (m = 24, ef_construction = 200);
