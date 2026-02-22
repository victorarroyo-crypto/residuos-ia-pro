-- ================================================================
-- VERIFICACION DE DATOS - Ejecutar en Supabase Dashboard > SQL Editor
-- ================================================================
-- Estas queries diagnostican si la ingesta de documentos, chunks
-- y embeddings esta funcionando correctamente.

-- 1. Hay documentos indexados?
SELECT count(*) AS total_documentos,
       count(CASE WHEN estado = 'indexado' THEN 1 END) AS indexados,
       count(CASE WHEN estado = 'error' THEN 1 END) AS con_error
FROM client_documents;

-- 2. Hay chunks con embeddings? (esto es lo que alimenta el RAG)
SELECT count(*) AS total_chunks,
       count(embedding) AS con_embedding,
       count(*) - count(embedding) AS sin_embedding
FROM document_chunks;

-- 3. Ultimos 10 documentos ingresados (aparecen los recientes?)
SELECT id, titulo, tipo, estado, total_chunks,
       fecha_ingesta, drive_file_id, client_id
FROM client_documents
ORDER BY fecha_ingesta DESC NULLS LAST
LIMIT 10;

-- 4. La columna drive_file_id existe? (migracion aplicada)
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_name = 'client_documents'
  AND column_name = 'drive_file_id';

-- 5. Historial de sincronizaciones
SELECT id, status, started_at, completed_at,
       total_files_found, files_ingested, files_skipped, files_failed
FROM gdrive_sync_log
ORDER BY started_at DESC
LIMIT 5;
