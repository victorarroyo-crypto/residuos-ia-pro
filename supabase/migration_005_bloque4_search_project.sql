-- ================================================================
-- BLOQUE 4: Función search_project (hybrid search)
-- Copiar y ejecutar en Supabase SQL Editor
-- ================================================================

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
LANGUAGE SQL STABLE AS $fn$
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
      pc.id AS chunk_id,
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
      vr.chunk_id,
      vr.document_id,
      vr.contenido,
      vr.chunk_type,
      vr.similarity,
      vr.doc_titulo,
      vr.doc_tipo,
      vr.doc_metadata,
      vr.storage_path,
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
$fn$;
