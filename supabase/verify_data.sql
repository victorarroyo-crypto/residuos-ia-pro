-- ================================================================
-- DIAGNOSTICO COMPLETO - ResidusIA Pro
-- ================================================================
-- Ejecutar en Supabase Dashboard > SQL Editor
-- Copia TODO este archivo y ejecutalo de una vez.
-- Lee los resultados de arriba a abajo para diagnosticar.
-- ================================================================

-- ════════════════════════════════════════════════════════════════
-- PASO 1: Existen las tablas necesarias?
-- ════════════════════════════════════════════════════════════════
-- Si alguna fila dice "NO EXISTE", necesitas ejecutar setup.sql
-- y las migraciones correspondientes.

SELECT 'TABLAS REQUERIDAS' AS diagnostico;

SELECT table_name,
       CASE WHEN table_name IS NOT NULL THEN '✅ EXISTE' END AS estado
FROM information_schema.tables
WHERE table_schema = 'public'
  AND table_name IN (
    'clients', 'projects', 'client_documents', 'document_chunks',
    'waste_inventory', 'invoice_lines', 'compliance_alerts',
    'savings_opportunities', 'waste_managers', 'contracts',
    'pipeline_progress', 'consultant_gdrive', 'gdrive_sync_log'
  )
ORDER BY table_name;

-- Tablas que FALTAN (si aparece algo aqui, ejecuta setup.sql + migraciones)
SELECT unnest(ARRAY[
  'clients', 'projects', 'client_documents', 'document_chunks',
  'waste_inventory', 'invoice_lines', 'compliance_alerts',
  'savings_opportunities', 'waste_managers', 'contracts',
  'pipeline_progress', 'consultant_gdrive', 'gdrive_sync_log'
]) AS tabla_requerida,
'❌ FALTA - ejecuta setup.sql' AS estado
EXCEPT
SELECT table_name, '❌ FALTA - ejecuta setup.sql'
FROM information_schema.tables
WHERE table_schema = 'public'
  AND table_name IN (
    'clients', 'projects', 'client_documents', 'document_chunks',
    'waste_inventory', 'invoice_lines', 'compliance_alerts',
    'savings_opportunities', 'waste_managers', 'contracts',
    'pipeline_progress', 'consultant_gdrive', 'gdrive_sync_log'
  );

-- ════════════════════════════════════════════════════════════════
-- PASO 2: Extension pgvector instalada?
-- ════════════════════════════════════════════════════════════════
SELECT 'EXTENSION PGVECTOR' AS diagnostico;

SELECT extname,
       CASE WHEN extname = 'vector' THEN '✅ pgvector instalado' END AS estado
FROM pg_extension
WHERE extname = 'vector';

-- ════════════════════════════════════════════════════════════════
-- PASO 3: Bucket de storage existe?
-- ════════════════════════════════════════════════════════════════
SELECT 'STORAGE BUCKET' AS diagnostico;

SELECT id AS bucket_name,
       CASE WHEN id = 'documentos' THEN '✅ Bucket existe' END AS estado
FROM storage.buckets
WHERE id = 'documentos';

-- ════════════════════════════════════════════════════════════════
-- PASO 4: Columna drive_file_id existe? (migracion 002)
-- ════════════════════════════════════════════════════════════════
SELECT 'MIGRACION 002 (drive_file_id)' AS diagnostico;

SELECT column_name, data_type,
       '✅ Migracion 002 aplicada' AS estado
FROM information_schema.columns
WHERE table_name = 'client_documents'
  AND column_name = 'drive_file_id';

-- ════════════════════════════════════════════════════════════════
-- PASO 5: Hay documentos indexados?
-- ════════════════════════════════════════════════════════════════
SELECT 'DOCUMENTOS' AS diagnostico;

SELECT count(*) AS total_documentos,
       count(CASE WHEN estado = 'indexado' THEN 1 END) AS indexados,
       count(CASE WHEN estado = 'error' THEN 1 END) AS con_error,
       count(CASE WHEN estado = 'procesando' THEN 1 END) AS procesando
FROM client_documents;

-- ════════════════════════════════════════════════════════════════
-- PASO 6: Hay chunks con embeddings? (CORAZON DEL RAG)
-- ════════════════════════════════════════════════════════════════
SELECT 'CHUNKS Y EMBEDDINGS (RAG)' AS diagnostico;

SELECT count(*) AS total_chunks,
       count(embedding) AS con_embedding,
       count(*) - count(embedding) AS sin_embedding
FROM document_chunks;

-- ════════════════════════════════════════════════════════════════
-- PASO 7: Ultimos documentos ingresados
-- ════════════════════════════════════════════════════════════════
SELECT 'ULTIMOS DOCUMENTOS' AS diagnostico;

SELECT id, titulo, tipo, estado, total_chunks,
       fecha_ingesta, drive_file_id
FROM client_documents
ORDER BY fecha_ingesta DESC NULLS LAST
LIMIT 10;

-- ════════════════════════════════════════════════════════════════
-- PASO 8: Historial de sincronizaciones Google Drive
-- ════════════════════════════════════════════════════════════════
SELECT 'SYNC LOG (Google Drive)' AS diagnostico;

SELECT id, status, started_at, completed_at,
       total_files_found, files_ingested, files_skipped, files_failed,
       error_message
FROM gdrive_sync_log
ORDER BY started_at DESC
LIMIT 5;

-- ════════════════════════════════════════════════════════════════
-- PASO 8b: REPARAR syncs atascados (>30 min en "running")
-- ════════════════════════════════════════════════════════════════
-- Descomenta las lineas UPDATE si quieres forzar la reparacion.
-- Por defecto solo muestra los syncs atascados.

SELECT 'SYNCS ATASCADOS (>30 min en running)' AS diagnostico;

SELECT id, consultant_id, started_at,
       now() - started_at AS tiempo_transcurrido,
       total_files_found, files_ingested
FROM gdrive_sync_log
WHERE status = 'running'
  AND started_at < now() - INTERVAL '30 minutes';

-- DESCOMENTA para reparar:
-- UPDATE gdrive_sync_log
-- SET status = 'error',
--     completed_at = now(),
--     error_message = 'Reparado manualmente: sync expirado tras >30 min sin respuesta.'
-- WHERE status = 'running'
--   AND started_at < now() - INTERVAL '30 minutes';

-- ════════════════════════════════════════════════════════════════
-- PASO 9: Funciones RAG existen?
-- ════════════════════════════════════════════════════════════════
SELECT 'FUNCIONES RAG' AS diagnostico;

SELECT routine_name AS funcion,
       '✅ Existe' AS estado
FROM information_schema.routines
WHERE routine_schema = 'public'
  AND routine_name IN ('search_chunks', 'search_chunks_scoped', 'search_chunks_combined');

-- ════════════════════════════════════════════════════════════════
-- PASO 10: Pipeline progress (la sincronizacion dejo rastro?)
-- ════════════════════════════════════════════════════════════════
SELECT 'PIPELINE PROGRESS' AS diagnostico;

SELECT * FROM pipeline_progress
ORDER BY updated_at DESC NULLS LAST
LIMIT 10;

-- ════════════════════════════════════════════════════════════════
-- PASO 11: Google Drive conectado?
-- ════════════════════════════════════════════════════════════════
SELECT 'GOOGLE DRIVE CONNECTION' AS diagnostico;

SELECT consultant_id,
       root_folder_id IS NOT NULL AS tiene_carpeta_raiz,
       auto_sync_enabled,
       last_synced_at,
       created_at AS conectado_desde
FROM consultant_gdrive;
