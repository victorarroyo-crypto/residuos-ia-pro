-- ================================================================
-- BLOQUE 5: Función search_combined (une ambos RAGs)
-- Copiar y ejecutar en Supabase SQL Editor
-- REQUIERE: bloques 3 y 4 ejecutados primero
-- ================================================================

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
LANGUAGE SQL STABLE AS $fn$
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
$fn$;
