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

SELECT 'TABLAS REQUERIDAS' AS diagnostico;

SELECT table_name,
       CASE WHEN table_name IS NOT NULL THEN '✅ EXISTE' END AS estado
FROM information_schema.tables
WHERE table_schema = 'public'
  AND table_name IN (
    'projects',
    'knowledge_documents', 'knowledge_chunks',
    'project_documents', 'project_chunks',
    'waste_inventory', 'invoice_lines', 'compliance_alerts',
    'savings_opportunities', 'waste_managers', 'contracts',
    'pipeline_progress', 'consultant_gdrive', 'gdrive_sync_log'
  )
ORDER BY table_name;

-- Tablas que FALTAN
SELECT unnest(ARRAY[
  'projects',
  'knowledge_documents', 'knowledge_chunks',
  'project_documents', 'project_chunks',
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
    'projects',
    'knowledge_documents', 'knowledge_chunks',
    'project_documents', 'project_chunks',
    'waste_inventory', 'invoice_lines', 'compliance_alerts',
    'savings_opportunities', 'waste_managers', 'contracts',
    'pipeline_progress', 'consultant_gdrive', 'gdrive_sync_log'
  );

-- Tablas VIEJAS que deberían haberse eliminado
SELECT 'TABLAS OBSOLETAS (deberían no existir)' AS diagnostico;
SELECT table_name, '⚠️ TABLA OBSOLETA - ejecuta migration_004' AS estado
FROM information_schema.tables
WHERE table_schema = 'public'
  AND table_name IN ('clients', 'client_documents', 'document_chunks');

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
-- PASO 4: RAG General (knowledge base)
-- ════════════════════════════════════════════════════════════════
SELECT 'RAG GENERAL (Knowledge Base)' AS diagnostico;

SELECT count(*) AS total_documentos,
       count(CASE WHEN estado = 'indexado' THEN 1 END) AS indexados,
       count(CASE WHEN estado = 'error' THEN 1 END) AS con_error
FROM knowledge_documents;

SELECT count(*) AS total_chunks,
       count(embedding) AS con_embedding,
       count(*) - count(embedding) AS sin_embedding
FROM knowledge_chunks;

-- Ultimos documentos de knowledge
SELECT id, titulo, tipo, estado, total_chunks,
       fecha_ingesta, drive_file_id
FROM knowledge_documents
ORDER BY fecha_ingesta DESC NULLS LAST
LIMIT 10;

-- ════════════════════════════════════════════════════════════════
-- PASO 5: RAG Proyecto (project docs)
-- ════════════════════════════════════════════════════════════════
SELECT 'RAG PROYECTO (Project Docs)' AS diagnostico;

SELECT count(*) AS total_documentos,
       count(CASE WHEN estado = 'indexado' THEN 1 END) AS indexados,
       count(CASE WHEN estado = 'error' THEN 1 END) AS con_error
FROM project_documents;

SELECT count(*) AS total_chunks,
       count(embedding) AS con_embedding,
       count(*) - count(embedding) AS sin_embedding
FROM project_chunks;

-- ════════════════════════════════════════════════════════════════
-- PASO 6: Historial de sincronizaciones Google Drive
-- ════════════════════════════════════════════════════════════════
SELECT 'SYNC LOG (Google Drive)' AS diagnostico;

SELECT id, status, started_at, completed_at,
       total_files_found, files_ingested, files_skipped, files_failed,
       error_message
FROM gdrive_sync_log
ORDER BY started_at DESC
LIMIT 5;

-- Syncs atascados (>30 min en running)
SELECT 'SYNCS ATASCADOS (>30 min en running)' AS diagnostico;

SELECT id, consultant_id, started_at,
       now() - started_at AS tiempo_transcurrido,
       total_files_found, files_ingested
FROM gdrive_sync_log
WHERE status = 'running'
  AND started_at < now() - INTERVAL '30 minutes';

-- ════════════════════════════════════════════════════════════════
-- PASO 7: Funciones RAG existen?
-- ════════════════════════════════════════════════════════════════
SELECT 'FUNCIONES RAG' AS diagnostico;

SELECT routine_name AS funcion,
       '✅ Existe' AS estado
FROM information_schema.routines
WHERE routine_schema = 'public'
  AND routine_name IN ('search_knowledge', 'search_project', 'search_combined');

-- ════════════════════════════════════════════════════════════════
-- PASO 8: Google Drive conectado?
-- ════════════════════════════════════════════════════════════════
SELECT 'GOOGLE DRIVE CONNECTION' AS diagnostico;

SELECT consultant_id,
       root_folder_id IS NOT NULL AS tiene_carpeta_raiz,
       auto_sync_enabled,
       last_synced_at,
       created_at AS conectado_desde
FROM consultant_gdrive;
