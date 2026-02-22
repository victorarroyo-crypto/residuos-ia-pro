-- ================================================================
-- Migration 004: Merge clients → projects + fix RAG scope
-- ================================================================
-- Idempotent: safe to run multiple times.
-- 1. Drop all dependent views/functions/policies FIRST
-- 2. Merge clients table into projects (single entity)
-- 3. Rename client_id → project_id across all tables
-- 4. Fix rag_scope column for existing chunks
-- 5. Recreate functions, views, policies
-- ================================================================

-- ────────────────────────────────────────────────────────
-- PART 0: Drop ALL dependent objects that reference client_id
-- (views, functions, policies must go BEFORE column renames)
-- ────────────────────────────────────────────────────────

-- Drop views
DROP VIEW IF EXISTS rag_stats CASCADE;

-- Drop functions that reference client_id
DROP FUNCTION IF EXISTS search_chunks(VECTOR(1536), UUID, TEXT, FLOAT, INT);
DROP FUNCTION IF EXISTS search_chunks_scoped(VECTOR(1536), TEXT, UUID, UUID, TEXT, FLOAT, INT);
DROP FUNCTION IF EXISTS search_chunks_scoped(VECTOR(1536), TEXT, UUID, TEXT, FLOAT, INT);
DROP FUNCTION IF EXISTS search_chunks_combined(VECTOR(1536), UUID, UUID, TEXT, FLOAT, INT, INT);

-- Drop ALL policies that might reference client_id or clients table
-- (use DO block for policies on clients table which may not exist)
DO $$
BEGIN
  BEGIN
    EXECUTE 'DROP POLICY IF EXISTS "consultant_own_clients" ON clients';
    EXECUTE 'DROP POLICY IF EXISTS "consultant_own_projects" ON clients';
  EXCEPTION WHEN undefined_table THEN NULL;
  END;
END;
$$;

DROP POLICY IF EXISTS "consultant_own_projects" ON projects;
DROP POLICY IF EXISTS "user_own_documents" ON client_documents;
DROP POLICY IF EXISTS "user_own_chunks" ON document_chunks;
DROP POLICY IF EXISTS "read_general_rag" ON document_chunks;
DROP POLICY IF EXISTS "read_scoped_chunks" ON document_chunks;
DROP POLICY IF EXISTS "insert_own_chunks" ON document_chunks;
DROP POLICY IF EXISTS "user_own_waste_inventory" ON waste_inventory;
DROP POLICY IF EXISTS "user_own_invoice_lines" ON invoice_lines;
DROP POLICY IF EXISTS "user_own_alerts" ON compliance_alerts;
DROP POLICY IF EXISTS "user_own_savings" ON savings_opportunities;
DROP POLICY IF EXISTS "user_own_contracts" ON contracts;
DROP POLICY IF EXISTS "consultant_upload_documents" ON storage.objects;
DROP POLICY IF EXISTS "consultant_read_documents" ON storage.objects;
DROP POLICY IF EXISTS "consultant_delete_documents" ON storage.objects;

-- Drop indexes that reference client_id
DROP INDEX IF EXISTS idx_client_docs_client;
DROP INDEX IF EXISTS idx_invoice_lines_client;
DROP INDEX IF EXISTS idx_alerts_client;
DROP INDEX IF EXISTS idx_projects_client;

-- ────────────────────────────────────────────────────────
-- PART A: Merge clients into projects
-- ────────────────────────────────────────────────────────

-- Add missing fields from clients to projects
ALTER TABLE projects ADD COLUMN IF NOT EXISTS cif TEXT;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS cnae TEXT;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS sector TEXT;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS comunidad_autonoma TEXT;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS municipio TEXT;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS direccion TEXT;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS contacto_nombre TEXT;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS contacto_email TEXT;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS contacto_telefono TEXT;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS notas TEXT;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS metadata JSONB DEFAULT '{}'::jsonb;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT now();

-- Copy data from clients to projects (if clients table exists and has data)
DO $$
BEGIN
  BEGIN
    INSERT INTO projects (id, consultant_id, nombre, cif, cnae, sector,
      comunidad_autonoma, municipio, direccion, contacto_nombre,
      contacto_email, contacto_telefono, notas, metadata, created_at, updated_at)
    SELECT id, consultant_id, nombre, cif, cnae, sector,
      comunidad_autonoma, municipio, direccion, contacto_nombre,
      contacto_email, contacto_telefono, notas, metadata, created_at, updated_at
    FROM clients
    WHERE id NOT IN (SELECT id FROM projects)
    ON CONFLICT (id) DO NOTHING;
  EXCEPTION WHEN undefined_column THEN
    BEGIN
      INSERT INTO projects (id, consultant_id, nombre, cif, cnae, sector,
        comunidad_autonoma, municipio, direccion, contacto_nombre,
        contacto_email, contacto_telefono, notas, created_at, updated_at)
      SELECT id, consultant_id, nombre, cif, cnae, sector,
        comunidad_autonoma, municipio, direccion, contacto_nombre,
        contacto_email, contacto_telefono, notas, created_at, updated_at
      FROM clients
      WHERE id NOT IN (SELECT id FROM projects)
      ON CONFLICT (id) DO NOTHING;
    EXCEPTION WHEN undefined_column THEN
      INSERT INTO projects (id, consultant_id, nombre, created_at)
      SELECT id, consultant_id, nombre, created_at
      FROM clients
      WHERE id NOT IN (SELECT id FROM projects)
      ON CONFLICT (id) DO NOTHING;
    END;
  END;
EXCEPTION WHEN undefined_table THEN
  RAISE NOTICE 'clients table not found, skipping data migration';
END;
$$;

-- ────────────────────────────────────────────────────────
-- PART B: Rename client_id → project_id in all tables
-- ────────────────────────────────────────────────────────

DO $$
DECLARE
  _tbl TEXT;
  _old_fk TEXT;
BEGIN
  FOREACH _tbl IN ARRAY ARRAY[
    'client_documents', 'waste_inventory', 'invoice_lines',
    'compliance_alerts', 'savings_opportunities', 'contracts'
  ]
  LOOP
    -- Only rename if client_id still exists (skip if already renamed)
    IF EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = _tbl AND column_name = 'client_id'
    ) THEN
      _old_fk := _tbl || '_client_id_fkey';
      EXECUTE format('ALTER TABLE %I DROP CONSTRAINT IF EXISTS %I', _tbl, _old_fk);
      EXECUTE format('ALTER TABLE %I RENAME COLUMN client_id TO project_id', _tbl);
      RAISE NOTICE 'Renamed client_id → project_id on %', _tbl;
    ELSE
      RAISE NOTICE 'Column client_id not found on %, skipping rename', _tbl;
    END IF;

    -- Ensure FK to projects exists
    IF EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = _tbl AND column_name = 'project_id'
    ) THEN
      _old_fk := _tbl || '_project_id_fkey';
      EXECUTE format('ALTER TABLE %I DROP CONSTRAINT IF EXISTS %I', _tbl, _old_fk);
      BEGIN
        EXECUTE format(
          'ALTER TABLE %I ADD CONSTRAINT %I FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE',
          _tbl, _old_fk
        );
      EXCEPTION WHEN others THEN
        RAISE NOTICE 'Could not add FK on %.project_id: %', _tbl, SQLERRM;
      END;
    END IF;
  END LOOP;
END;
$$;

-- Drop old projects.client_id column (referenced old clients table)
ALTER TABLE projects DROP COLUMN IF EXISTS client_id;

-- Recreate indexes with new column name
CREATE INDEX IF NOT EXISTS idx_client_docs_project ON client_documents(project_id);
CREATE INDEX IF NOT EXISTS idx_invoice_lines_project ON invoice_lines(project_id);
CREATE INDEX IF NOT EXISTS idx_alerts_project ON compliance_alerts(project_id);

-- ────────────────────────────────────────────────────────
-- PART C: Fix RAG scope
-- ────────────────────────────────────────────────────────

ALTER TABLE document_chunks
  ALTER COLUMN rag_scope SET DEFAULT 'general';

-- Fix existing chunks: normativa docs → general
UPDATE document_chunks dc
SET rag_scope = 'general'
FROM client_documents cd
WHERE dc.document_id = cd.id
  AND (cd.tipo = 'normativa' OR cd.project_id IS NULL);

-- Fix from metadata if available
UPDATE document_chunks
SET rag_scope = metadata->>'rag_scope'
WHERE metadata->>'rag_scope' IS NOT NULL
  AND metadata->>'rag_scope' IN ('general', 'project')
  AND rag_scope IS DISTINCT FROM metadata->>'rag_scope';

-- ────────────────────────────────────────────────────────
-- PART D: Recreate RLS policies
-- ────────────────────────────────────────────────────────

ALTER TABLE projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE client_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE document_chunks ENABLE ROW LEVEL SECURITY;
ALTER TABLE waste_inventory ENABLE ROW LEVEL SECURITY;
ALTER TABLE invoice_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE compliance_alerts ENABLE ROW LEVEL SECURITY;
ALTER TABLE savings_opportunities ENABLE ROW LEVEL SECURITY;
ALTER TABLE contracts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "consultant_own_projects" ON projects
  FOR ALL USING (consultant_id = auth.uid());

CREATE POLICY "user_own_documents" ON client_documents
  FOR ALL USING (
    project_id IS NULL
    OR project_id IN (SELECT id FROM projects WHERE consultant_id = auth.uid())
  );

CREATE POLICY "read_scoped_chunks" ON document_chunks
  FOR SELECT USING (
    rag_scope = 'general'
    OR document_id IN (
      SELECT id FROM client_documents WHERE project_id IN (
        SELECT id FROM projects WHERE consultant_id = auth.uid()
      )
    )
  );

CREATE POLICY "insert_own_chunks" ON document_chunks
  FOR INSERT WITH CHECK (
    rag_scope = 'general'
    OR document_id IN (
      SELECT id FROM client_documents WHERE project_id IN (
        SELECT id FROM projects WHERE consultant_id = auth.uid()
      )
    )
  );

CREATE POLICY "user_own_waste_inventory" ON waste_inventory
  FOR ALL USING (
    project_id IN (SELECT id FROM projects WHERE consultant_id = auth.uid())
  );

CREATE POLICY "user_own_invoice_lines" ON invoice_lines
  FOR ALL USING (
    project_id IN (SELECT id FROM projects WHERE consultant_id = auth.uid())
  );

CREATE POLICY "user_own_alerts" ON compliance_alerts
  FOR ALL USING (
    project_id IN (SELECT id FROM projects WHERE consultant_id = auth.uid())
  );

CREATE POLICY "user_own_savings" ON savings_opportunities
  FOR ALL USING (
    project_id IN (SELECT id FROM projects WHERE consultant_id = auth.uid())
  );

CREATE POLICY "user_own_contracts" ON contracts
  FOR ALL USING (
    project_id IN (SELECT id FROM projects WHERE consultant_id = auth.uid())
  );

CREATE POLICY "consultant_upload_documents" ON storage.objects
  FOR INSERT WITH CHECK (
    bucket_id = 'documentos'
    AND (
      (storage.foldername(name))[1] = 'general'
      OR (storage.foldername(name))[1] IN (
        SELECT id::text FROM projects WHERE consultant_id = auth.uid()
      )
    )
  );

CREATE POLICY "consultant_read_documents" ON storage.objects
  FOR SELECT USING (
    bucket_id = 'documentos'
    AND (
      (storage.foldername(name))[1] = 'general'
      OR (storage.foldername(name))[1] IN (
        SELECT id::text FROM projects WHERE consultant_id = auth.uid()
      )
    )
  );

CREATE POLICY "consultant_delete_documents" ON storage.objects
  FOR DELETE USING (
    bucket_id = 'documentos'
    AND (
      (storage.foldername(name))[1] = 'general'
      OR (storage.foldername(name))[1] IN (
        SELECT id::text FROM projects WHERE consultant_id = auth.uid()
      )
    )
  );

-- ────────────────────────────────────────────────────────
-- PART E: Recreate SQL functions (with project_id only)
-- ────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION search_chunks_scoped(
  query_embedding     VECTOR(1536),
  rag_scope_filter    TEXT,
  project_id_filter   UUID    DEFAULT NULL,
  doc_type_filter     TEXT    DEFAULT NULL,
  match_threshold     FLOAT   DEFAULT 0.70,
  match_count         INT     DEFAULT 5
)
RETURNS TABLE (
  chunk_id TEXT, document_id TEXT, contenido TEXT, chunk_type TEXT,
  similarity FLOAT, doc_titulo TEXT, doc_tipo TEXT, doc_metadata JSONB,
  storage_path TEXT, rag_scope TEXT
)
LANGUAGE SQL STABLE AS $$
  SELECT
    dc.id AS chunk_id, dc.document_id, dc.contenido, dc.chunk_type,
    1 - (dc.embedding <=> query_embedding) AS similarity,
    cd.titulo AS doc_titulo, cd.tipo AS doc_tipo,
    cd.metadata AS doc_metadata, cd.storage_path, dc.rag_scope
  FROM document_chunks dc
  JOIN client_documents cd ON dc.document_id = cd.id
  WHERE
    dc.rag_scope = rag_scope_filter
    AND (
      rag_scope_filter = 'general'
      OR (project_id_filter IS NULL OR dc.project_id = project_id_filter)
    )
    AND (doc_type_filter IS NULL OR cd.tipo = doc_type_filter)
    AND 1 - (dc.embedding <=> query_embedding) > match_threshold
  ORDER BY dc.embedding <=> query_embedding
  LIMIT match_count;
$$;

-- Recreate view
CREATE OR REPLACE VIEW rag_stats AS
SELECT
  dc.rag_scope, cd.tipo AS doc_type, cd.project_id,
  COUNT(DISTINCT cd.id) AS num_documents,
  COUNT(dc.id) AS num_chunks,
  AVG(dc.tokens) AS avg_tokens_per_chunk,
  MAX(cd.fecha_ingesta) AS last_ingestion
FROM document_chunks dc
JOIN client_documents cd ON dc.document_id = cd.id
WHERE dc.embedding IS NOT NULL
GROUP BY dc.rag_scope, cd.tipo, cd.project_id;

-- ────────────────────────────────────────────────────────
-- PART F: Drop clients table (no longer needed)
-- ────────────────────────────────────────────────────────
DROP TABLE IF EXISTS clients CASCADE;

-- ────────────────────────────────────────────────────────
-- VERIFICATION QUERIES (uncomment to run after migration)
-- ────────────────────────────────────────────────────────
-- SELECT rag_scope, COUNT(*) FROM document_chunks GROUP BY rag_scope;
-- SELECT COUNT(*) FROM projects;
-- SELECT table_name, column_name FROM information_schema.columns
--   WHERE column_name = 'client_id' AND table_schema = 'public';
