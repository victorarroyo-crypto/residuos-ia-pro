-- ================================================================
-- MIGRATION 005: RAG Improvements - Hybrid Search, HNSW Tuning
-- ================================================================
-- Ejecutar en Supabase SQL Editor.
--
-- Mejoras:
--   1. Índice GIN para búsqueda full-text (BM25-like) en español
--   2. Funciones de búsqueda híbrida (vector + full-text)
--   3. Índices HNSW tuneados (M=24, ef_construction=200)
--   4. Columna content_hash para deduplicación
--   5. Endpoint de diagnóstico de salud del RAG
-- ================================================================

-- ════════════════════════════════════════════════════════════════
-- 1. FULL-TEXT SEARCH: columna tsvector + índice GIN
-- ════════════════════════════════════════════════════════════════

-- Knowledge chunks: añadir columna tsvector para búsqueda full-text
ALTER TABLE knowledge_chunks
  ADD COLUMN IF NOT EXISTS tsv tsvector
    GENERATED ALWAYS AS (to_tsvector('spanish', coalesce(contenido, ''))) STORED;

CREATE INDEX IF NOT EXISTS idx_knowledge_chunks_tsv
  ON knowledge_chunks USING gin(tsv);

-- Project chunks: añadir columna tsvector para búsqueda full-text
ALTER TABLE project_chunks
  ADD COLUMN IF NOT EXISTS tsv tsvector
    GENERATED ALWAYS AS (to_tsvector('spanish', coalesce(contenido, ''))) STORED;

CREATE INDEX IF NOT EXISTS idx_project_chunks_tsv
  ON project_chunks USING gin(tsv);

-- ════════════════════════════════════════════════════════════════
-- 2. CONTENT HASH para deduplicación
-- ════════════════════════════════════════════════════════════════

ALTER TABLE knowledge_documents
  ADD COLUMN IF NOT EXISTS content_hash TEXT;

ALTER TABLE project_documents
  ADD COLUMN IF NOT EXISTS content_hash TEXT;

CREATE INDEX IF NOT EXISTS idx_knowledge_docs_hash
  ON knowledge_documents(content_hash) WHERE content_hash IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_project_docs_hash
  ON project_documents(content_hash) WHERE content_hash IS NOT NULL;

-- ════════════════════════════════════════════════════════════════
-- 3. HNSW TUNEADO: recrear índices con mejores parámetros
--    M=24 (más conexiones = mejor recall)
--    ef_construction=200 (mejor calidad de índice)
-- ════════════════════════════════════════════════════════════════

DROP INDEX IF EXISTS idx_knowledge_chunks_embedding;
CREATE INDEX idx_knowledge_chunks_embedding ON knowledge_chunks
  USING hnsw (embedding vector_cosine_ops)
  WITH (m = 24, ef_construction = 200);

DROP INDEX IF EXISTS idx_project_chunks_embedding;
CREATE INDEX idx_project_chunks_embedding ON project_chunks
  USING hnsw (embedding vector_cosine_ops)
  WITH (m = 24, ef_construction = 200);

-- ════════════════════════════════════════════════════════════════
-- 4. FUNCIONES HYBRID SEARCH (vector + full-text con RRF)
-- ════════════════════════════════════════════════════════════════

-- Reciprocal Rank Fusion: combina rankings de vector y full-text
-- score = alpha * vector_score + (1 - alpha) * text_score

CREATE OR REPLACE FUNCTION search_knowledge(
  query_embedding     VECTOR(1536),
  doc_type_filter     TEXT    DEFAULT NULL,
  match_threshold     FLOAT  DEFAULT 0.50,
  match_count         INT    DEFAULT 10,
  query_text          TEXT   DEFAULT NULL,
  alpha               FLOAT  DEFAULT 0.7
)
RETURNS TABLE (
  chunk_id      TEXT,
  document_id   TEXT,
  contenido     TEXT,
  chunk_type    TEXT,
  similarity    FLOAT,
  text_rank     FLOAT,
  hybrid_score  FLOAT,
  doc_titulo    TEXT,
  doc_tipo      TEXT,
  doc_metadata  JSONB,
  storage_path  TEXT
)
LANGUAGE SQL STABLE AS $$
  WITH vector_results AS (
    SELECT
      kc.id            AS chunk_id,
      kc.document_id,
      kc.contenido,
      kc.chunk_type,
      1 - (kc.embedding <=> query_embedding) AS similarity,
      kd.titulo        AS doc_titulo,
      kd.tipo          AS doc_tipo,
      kd.metadata      AS doc_metadata,
      kd.storage_path
    FROM knowledge_chunks kc
    JOIN knowledge_documents kd ON kc.document_id = kd.id
    WHERE
      kc.embedding IS NOT NULL
      AND (doc_type_filter IS NULL OR kd.tipo = doc_type_filter)
      AND 1 - (kc.embedding <=> query_embedding) > match_threshold
    ORDER BY kc.embedding <=> query_embedding
    LIMIT match_count * 2
  ),
  text_results AS (
    SELECT
      kc.id            AS chunk_id,
      ts_rank_cd(kc.tsv, websearch_to_tsquery('spanish', coalesce(query_text, '')), 32) AS text_rank
    FROM knowledge_chunks kc
    WHERE
      query_text IS NOT NULL
      AND query_text != ''
      AND kc.tsv @@ websearch_to_tsquery('spanish', query_text)
    LIMIT match_count * 2
  ),
  combined AS (
    SELECT
      vr.*,
      coalesce(tr.text_rank, 0.0) AS text_rank,
      (alpha * vr.similarity + (1 - alpha) * coalesce(tr.text_rank, 0.0)) AS hybrid_score
    FROM vector_results vr
    LEFT JOIN text_results tr ON vr.chunk_id = tr.chunk_id
  )
  SELECT
    chunk_id, document_id, contenido, chunk_type,
    similarity::FLOAT, text_rank::FLOAT, hybrid_score::FLOAT,
    doc_titulo, doc_tipo, doc_metadata, storage_path
  FROM combined
  ORDER BY hybrid_score DESC
  LIMIT match_count;
$$;

-- Búsqueda híbrida en RAG de Proyecto
CREATE OR REPLACE FUNCTION search_project(
  query_embedding     VECTOR(1536),
  p_project_id        UUID,
  doc_type_filter     TEXT    DEFAULT NULL,
  match_threshold     FLOAT  DEFAULT 0.50,
  match_count         INT    DEFAULT 10,
  query_text          TEXT   DEFAULT NULL,
  alpha               FLOAT  DEFAULT 0.7
)
RETURNS TABLE (
  chunk_id      TEXT,
  document_id   TEXT,
  contenido     TEXT,
  chunk_type    TEXT,
  similarity    FLOAT,
  text_rank     FLOAT,
  hybrid_score  FLOAT,
  doc_titulo    TEXT,
  doc_tipo      TEXT,
  doc_metadata  JSONB,
  storage_path  TEXT
)
LANGUAGE SQL STABLE AS $$
  WITH vector_results AS (
    SELECT
      pc.id            AS chunk_id,
      pc.document_id,
      pc.contenido,
      pc.chunk_type,
      1 - (pc.embedding <=> query_embedding) AS similarity,
      pd.titulo        AS doc_titulo,
      pd.tipo          AS doc_tipo,
      pd.metadata      AS doc_metadata,
      pd.storage_path
    FROM project_chunks pc
    JOIN project_documents pd ON pc.document_id = pd.id
    WHERE
      pc.project_id = p_project_id
      AND pc.embedding IS NOT NULL
      AND (doc_type_filter IS NULL OR pd.tipo = doc_type_filter)
      AND 1 - (pc.embedding <=> query_embedding) > match_threshold
    ORDER BY pc.embedding <=> query_embedding
    LIMIT match_count * 2
  ),
  text_results AS (
    SELECT
      pc.id            AS chunk_id,
      ts_rank_cd(pc.tsv, websearch_to_tsquery('spanish', coalesce(query_text, '')), 32) AS text_rank
    FROM project_chunks pc
    WHERE
      pc.project_id = p_project_id
      AND query_text IS NOT NULL
      AND query_text != ''
      AND pc.tsv @@ websearch_to_tsquery('spanish', query_text)
    LIMIT match_count * 2
  ),
  combined AS (
    SELECT
      vr.*,
      coalesce(tr.text_rank, 0.0) AS text_rank,
      (alpha * vr.similarity + (1 - alpha) * coalesce(tr.text_rank, 0.0)) AS hybrid_score
    FROM vector_results vr
    LEFT JOIN text_results tr ON vr.chunk_id = tr.chunk_id
  )
  SELECT
    chunk_id, document_id, contenido, chunk_type,
    similarity::FLOAT, text_rank::FLOAT, hybrid_score::FLOAT,
    doc_titulo, doc_tipo, doc_metadata, storage_path
  FROM combined
  ORDER BY hybrid_score DESC
  LIMIT match_count;
$$;

-- Búsqueda combinada híbrida (ambos RAGs)
CREATE OR REPLACE FUNCTION search_combined(
  query_embedding     VECTOR(1536),
  p_project_id        UUID    DEFAULT NULL,
  doc_type_filter     TEXT    DEFAULT NULL,
  match_threshold     FLOAT  DEFAULT 0.50,
  match_count_kb      INT    DEFAULT 10,
  match_count_project INT    DEFAULT 10,
  query_text          TEXT   DEFAULT NULL,
  alpha               FLOAT  DEFAULT 0.7
)
RETURNS TABLE (
  chunk_id      TEXT,
  document_id   TEXT,
  contenido     TEXT,
  chunk_type    TEXT,
  similarity    FLOAT,
  text_rank     FLOAT,
  hybrid_score  FLOAT,
  doc_titulo    TEXT,
  doc_tipo      TEXT,
  doc_metadata  JSONB,
  storage_path  TEXT,
  source        TEXT
)
LANGUAGE SQL STABLE AS $$
  (
    SELECT sk.*, 'knowledge'::TEXT AS source
    FROM search_knowledge(
      query_embedding, doc_type_filter, match_threshold,
      match_count_kb, query_text, alpha
    ) sk
  )
  UNION ALL
  (
    SELECT sp.*, 'project'::TEXT AS source
    FROM search_project(
      query_embedding, p_project_id, doc_type_filter, match_threshold,
      match_count_project, query_text, alpha
    ) sp
    WHERE p_project_id IS NOT NULL
  )
  ORDER BY hybrid_score DESC;
$$;

-- ════════════════════════════════════════════════════════════════
-- 5. FUNCIÓN DE DIAGNÓSTICO: documentos sin chunks
-- ════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION rag_health_check()
RETURNS TABLE (
  scope           TEXT,
  total_documents BIGINT,
  docs_with_chunks BIGINT,
  docs_without_chunks BIGINT,
  total_chunks    BIGINT,
  avg_chunks_per_doc FLOAT,
  docs_needing_reprocess TEXT[]
)
LANGUAGE SQL STABLE AS $$
  -- Knowledge base health
  SELECT
    'knowledge'::TEXT AS scope,
    (SELECT count(*) FROM knowledge_documents) AS total_documents,
    (SELECT count(DISTINCT kc.document_id) FROM knowledge_chunks kc
     WHERE kc.embedding IS NOT NULL) AS docs_with_chunks,
    (SELECT count(*) FROM knowledge_documents kd
     WHERE NOT EXISTS (
       SELECT 1 FROM knowledge_chunks kc
       WHERE kc.document_id = kd.id AND kc.embedding IS NOT NULL
     )) AS docs_without_chunks,
    (SELECT count(*) FROM knowledge_chunks WHERE embedding IS NOT NULL) AS total_chunks,
    (SELECT avg(cnt)::FLOAT FROM (
       SELECT count(*) AS cnt FROM knowledge_chunks
       WHERE embedding IS NOT NULL
       GROUP BY document_id
     ) sub) AS avg_chunks_per_doc,
    (SELECT array_agg(kd.id) FROM knowledge_documents kd
     WHERE NOT EXISTS (
       SELECT 1 FROM knowledge_chunks kc
       WHERE kc.document_id = kd.id AND kc.embedding IS NOT NULL
     )) AS docs_needing_reprocess
  UNION ALL
  SELECT
    'project'::TEXT AS scope,
    (SELECT count(*) FROM project_documents) AS total_documents,
    (SELECT count(DISTINCT pc.document_id) FROM project_chunks pc
     WHERE pc.embedding IS NOT NULL) AS docs_with_chunks,
    (SELECT count(*) FROM project_documents pd
     WHERE NOT EXISTS (
       SELECT 1 FROM project_chunks pc
       WHERE pc.document_id = pd.id AND pc.embedding IS NOT NULL
     )) AS docs_without_chunks,
    (SELECT count(*) FROM project_chunks WHERE embedding IS NOT NULL) AS total_chunks,
    (SELECT avg(cnt)::FLOAT FROM (
       SELECT count(*) AS cnt FROM project_chunks
       WHERE embedding IS NOT NULL
       GROUP BY document_id
     ) sub) AS avg_chunks_per_doc,
    (SELECT array_agg(pd.id) FROM project_documents pd
     WHERE NOT EXISTS (
       SELECT 1 FROM project_chunks pc
       WHERE pc.document_id = pd.id AND pc.embedding IS NOT NULL
     )) AS docs_needing_reprocess;
$$;
