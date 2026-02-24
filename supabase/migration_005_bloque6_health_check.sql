-- ================================================================
-- BLOQUE 6 (OPCIONAL): Función de diagnóstico rag_health_check
-- Solo para debugging - no la usa el código en producción
-- ================================================================

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
LANGUAGE SQL STABLE AS $fn$
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
$fn$;
