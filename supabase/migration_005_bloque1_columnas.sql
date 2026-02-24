-- ================================================================
-- BLOQUE 1: Columnas nuevas (seguro, idempotente)
-- Copiar y ejecutar en Supabase SQL Editor
-- ================================================================

-- content_hash: deduplicación de documentos
ALTER TABLE knowledge_documents
  ADD COLUMN IF NOT EXISTS content_hash TEXT;

ALTER TABLE project_documents
  ADD COLUMN IF NOT EXISTS content_hash TEXT;

-- tsv: columna tsvector para búsqueda full-text en español
-- Se genera automáticamente a partir del campo 'contenido'
ALTER TABLE knowledge_chunks
  ADD COLUMN IF NOT EXISTS tsv tsvector
    GENERATED ALWAYS AS (to_tsvector('spanish', coalesce(contenido, ''))) STORED;

ALTER TABLE project_chunks
  ADD COLUMN IF NOT EXISTS tsv tsvector
    GENERATED ALWAYS AS (to_tsvector('spanish', coalesce(contenido, ''))) STORED;
