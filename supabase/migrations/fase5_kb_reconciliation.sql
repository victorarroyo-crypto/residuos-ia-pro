-- Fase 5: reconciliacion Base de Conocimiento <-> Google Drive.
--
-- Los indicadores de la pagina KB se calculaban trayendo TODAS las filas de
-- knowledge_documents y contandolas en JS/Python. PostgREST corta en 1000
-- filas por defecto, asi que "Documentos indexados" se quedaba congelado en
-- 1000 aunque hubiera 7000+. Esta funcion lo calcula en la BD (sin tope) y de
-- paso reconcilia lo indexado contra lo que el ultimo escaneo vio en Drive.
--
-- Fuente de "lo que hay en Drive": ingest_jobs (1 fila = 1 archivo descubierto
-- por el sync). Es el ULTIMO escaneo, no Drive en vivo. La UI lo etiqueta como
-- tal. knowledge_documents es el RAG general (global, sin consultant_id), asi
-- que la reconciliacion agrega globalmente.
--
-- Clasificacion del hueco "en Drive pero no indexado":
--   - md_skipped: ficheros .md omitidos a proposito porque su PDF gemelo si
--                 esta indexado (prioridad PDF en el sync). NO es un problema.
--   - real_gaps:  el resto (PDF/Excel que fallaron o no generaron documento).
--                 Estos si deberian estar y faltan.
-- orphans: indexados cuyo drive_file_id ya no aparece en ingest_jobs (borrados
--          o movidos en Drive tras indexarse). El sync incremental no purga.

CREATE OR REPLACE FUNCTION knowledge_base_reconciliation()
RETURNS jsonb
LANGUAGE sql
STABLE
AS $$
  SELECT jsonb_build_object(
    -- Conteos correctos (count/sum en la BD, sin el tope de 1000 de PostgREST).
    'total_documents', (SELECT count(*) FROM knowledge_documents),
    -- Chunks REALES (filas en knowledge_chunks), no la suma de la columna
    -- total_chunks de knowledge_documents, que puede estar inflada respecto a
    -- los chunks realmente persistidos (ver P5 de la auditoria).
    'total_chunks',    (SELECT count(*) FROM knowledge_chunks),
    'total_pages',     (SELECT COALESCE(sum(total_paginas), 0)::bigint FROM knowledge_documents),
    'by_type', (
      SELECT COALESCE(jsonb_object_agg(tipo, n), '{}'::jsonb)
      FROM (
        SELECT COALESCE(tipo, 'desconocido') AS tipo, count(*) AS n
        FROM knowledge_documents
        GROUP BY COALESCE(tipo, 'desconocido')
      ) t
    ),

    -- Lado "indexado".
    'manual_uploads', (SELECT count(*) FROM knowledge_documents WHERE drive_file_id IS NULL),

    -- Lado "Drive" (ultimo escaneo).
    'drive_files_seen', (SELECT count(DISTINCT drive_file_id) FROM ingest_jobs),

    -- Hueco: en Drive pero NO indexado, desglosado.
    'in_drive_not_indexed', (
      SELECT count(*) FROM ingest_jobs j
      WHERE NOT EXISTS (
        SELECT 1 FROM knowledge_documents kd WHERE kd.drive_file_id = j.drive_file_id
      )
    ),
    'md_skipped', (
      SELECT count(*) FROM ingest_jobs j
      WHERE lower(j.file_name) LIKE '%.md'
        AND NOT EXISTS (
          SELECT 1 FROM knowledge_documents kd WHERE kd.drive_file_id = j.drive_file_id
        )
    ),
    'real_gaps', (
      SELECT count(*) FROM ingest_jobs j
      WHERE (j.file_name IS NULL OR lower(j.file_name) NOT LIKE '%.md')
        AND NOT EXISTS (
          SELECT 1 FROM knowledge_documents kd WHERE kd.drive_file_id = j.drive_file_id
        )
    ),

    -- Huerfanos: indexados que ya no estan en el ultimo escaneo de Drive.
    'orphans', (
      SELECT count(*) FROM knowledge_documents kd
      WHERE kd.drive_file_id IS NOT NULL
        AND NOT EXISTS (
          SELECT 1 FROM ingest_jobs j WHERE j.drive_file_id = kd.drive_file_id
        )
    )
  );
$$;

COMMENT ON FUNCTION knowledge_base_reconciliation() IS
  'Fase 5: conteos KB (sin tope 1000) + reconciliacion indexado vs Drive (ultimo escaneo via ingest_jobs). Devuelve jsonb.';

GRANT EXECUTE ON FUNCTION knowledge_base_reconciliation() TO service_role, authenticated;
