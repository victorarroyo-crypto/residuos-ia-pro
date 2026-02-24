-- ================================================================
-- BLOQUE 3: Función search_knowledge (hybrid search)
-- Copiar y ejecutar en Supabase SQL Editor
-- ================================================================

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
LANGUAGE SQL STABLE AS $fn$
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
      kc.id AS chunk_id,
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
