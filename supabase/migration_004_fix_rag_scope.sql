-- ================================================================
-- Migration 004: Merge clients → projects + fix RAG scope
-- ================================================================
-- 1. Merge clients table into projects (single entity)
-- 2. Rename client_id → project_id across all tables
-- 3. Fix rag_scope column for existing chunks
-- ================================================================

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
ALTER TABLE projects ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT now();

-- Copy data from clients to projects (if clients has data and projects doesn't)
INSERT INTO projects (id, consultant_id, nombre, cif, cnae, sector,
  comunidad_autonoma, municipio, direccion, contacto_nombre,
  contacto_email, contacto_telefono, notas, metadata, created_at, updated_at)
SELECT id, consultant_id, nombre, cif, cnae, sector,
  comunidad_autonoma, municipio, direccion, contacto_nombre,
  contacto_email, contacto_telefono, notas, metadata, created_at, updated_at
FROM clients
WHERE id NOT IN (SELECT id FROM projects)
ON CONFLICT (id) DO NOTHING;

-- ────────────────────────────────────────────────────────
-- PART B: Rename client_id → project_id in all tables
-- ────────────────────────────────────────────────────────

-- client_documents
ALTER TABLE client_documents
  DROP CONSTRAINT IF EXISTS client_documents_client_id_fkey;
ALTER TABLE client_documents
  RENAME COLUMN client_id TO project_id;
ALTER TABLE client_documents
  ADD CONSTRAINT client_documents_project_id_fkey
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE;

-- Update docs that referenced clients → now reference projects
UPDATE client_documents cd
SET project_id = c.id
FROM clients c
WHERE cd.project_id = c.id
  AND c.id NOT IN (SELECT id FROM projects);
-- (no-op if clients data was already copied to projects)

-- waste_inventory
ALTER TABLE waste_inventory
  DROP CONSTRAINT IF EXISTS waste_inventory_client_id_fkey;
ALTER TABLE waste_inventory
  RENAME COLUMN client_id TO project_id;
ALTER TABLE waste_inventory
  ADD CONSTRAINT waste_inventory_project_id_fkey
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE;

-- invoice_lines
ALTER TABLE invoice_lines
  DROP CONSTRAINT IF EXISTS invoice_lines_client_id_fkey;
ALTER TABLE invoice_lines
  RENAME COLUMN client_id TO project_id;
ALTER TABLE invoice_lines
  ADD CONSTRAINT invoice_lines_project_id_fkey
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE;

-- compliance_alerts
ALTER TABLE compliance_alerts
  DROP CONSTRAINT IF EXISTS compliance_alerts_client_id_fkey;
ALTER TABLE compliance_alerts
  RENAME COLUMN client_id TO project_id;
ALTER TABLE compliance_alerts
  ADD CONSTRAINT compliance_alerts_project_id_fkey
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE;

-- savings_opportunities
ALTER TABLE savings_opportunities
  DROP CONSTRAINT IF EXISTS savings_opportunities_client_id_fkey;
ALTER TABLE savings_opportunities
  RENAME COLUMN client_id TO project_id;
ALTER TABLE savings_opportunities
  ADD CONSTRAINT savings_opportunities_project_id_fkey
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE;

-- contracts
ALTER TABLE contracts
  DROP CONSTRAINT IF EXISTS contracts_client_id_fkey;
ALTER TABLE contracts
  RENAME COLUMN client_id TO project_id;
ALTER TABLE contracts
  ADD CONSTRAINT contracts_project_id_fkey
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE;

-- Drop old projects.client_id column (referenced old clients table)
ALTER TABLE projects DROP COLUMN IF EXISTS client_id;

-- ────────────────────────────────────────────────────────
-- PART C: Fix RAG scope
-- ────────────────────────────────────────────────────────

-- Change default from 'project' to 'general' for chunks without project
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
-- PART D: Update RLS policies
-- ────────────────────────────────────────────────────────

-- Drop old policies referencing clients
DROP POLICY IF EXISTS "consultant_own_clients" ON clients;
DROP POLICY IF EXISTS "user_own_documents" ON client_documents;
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

-- Recreate policies using projects table
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

-- Storage policies
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
-- PART E: Update SQL functions
-- ────────────────────────────────────────────────────────

-- Drop old functions
DROP FUNCTION IF EXISTS search_chunks(VECTOR(1536), UUID, TEXT, FLOAT, INT);
DROP FUNCTION IF EXISTS search_chunks_scoped(VECTOR(1536), TEXT, UUID, UUID, TEXT, FLOAT, INT);
DROP FUNCTION IF EXISTS search_chunks_combined(VECTOR(1536), UUID, UUID, TEXT, FLOAT, INT, INT);

-- Recreate with project_id only (no client_id)
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

-- Update view
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
-- VERIFICATION QUERIES (uncomment to run)
-- ────────────────────────────────────────────────────────
-- SELECT rag_scope, COUNT(*) FROM document_chunks GROUP BY rag_scope;
-- SELECT COUNT(*) FROM projects;
-- SELECT table_name, column_name FROM information_schema.columns
--   WHERE column_name = 'client_id' AND table_schema = 'public';
