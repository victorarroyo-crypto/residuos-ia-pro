-- ================================================================
-- Migration 004: Separar RAG General y RAG de Proyecto
-- ================================================================
-- Transforma:
--   client_documents + document_chunks (tabla única)
-- En:
--   knowledge_documents + knowledge_chunks (RAG General)
--   project_documents   + project_chunks   (RAG Proyecto)
--
-- Idempotent: safe to run multiple times.
-- ================================================================

-- ────────────────────────────────────────────────────────
-- PART 0: Extensions + Drop ALL dependent objects
-- ────────────────────────────────────────────────────────

CREATE EXTENSION IF NOT EXISTS vector;

DROP VIEW IF EXISTS rag_stats CASCADE;
DROP VIEW IF EXISTS knowledge_stats CASCADE;
DROP VIEW IF EXISTS project_stats CASCADE;

DROP FUNCTION IF EXISTS search_chunks(VECTOR(1536), UUID, TEXT, FLOAT, INT);
DROP FUNCTION IF EXISTS search_chunks_scoped(VECTOR(1536), TEXT, UUID, UUID, TEXT, FLOAT, INT);
DROP FUNCTION IF EXISTS search_chunks_scoped(VECTOR(1536), TEXT, UUID, TEXT, FLOAT, INT);
DROP FUNCTION IF EXISTS search_chunks_combined(VECTOR(1536), UUID, UUID, TEXT, FLOAT, INT, INT);
DROP FUNCTION IF EXISTS search_chunks_combined(VECTOR(1536), UUID, TEXT, FLOAT, INT, INT);
DROP FUNCTION IF EXISTS search_knowledge(VECTOR(1536), TEXT, FLOAT, INT);
DROP FUNCTION IF EXISTS search_project(VECTOR(1536), UUID, TEXT, FLOAT, INT);
DROP FUNCTION IF EXISTS search_combined(VECTOR(1536), UUID, TEXT, FLOAT, INT, INT);

-- Drop all policies that might exist (old and new names)
DO $$
BEGIN
  BEGIN
    EXECUTE 'DROP POLICY IF EXISTS "consultant_own_clients" ON clients';
  EXCEPTION WHEN undefined_table THEN NULL;
  END;
END;
$$;

DO $$
DECLARE
  _sql TEXT;
BEGIN
  FOREACH _sql IN ARRAY ARRAY[
    'DROP POLICY IF EXISTS "consultant_own_projects" ON projects',
    'DROP POLICY IF EXISTS "user_own_documents" ON client_documents',
    'DROP POLICY IF EXISTS "user_own_chunks" ON document_chunks',
    'DROP POLICY IF EXISTS "read_general_rag" ON document_chunks',
    'DROP POLICY IF EXISTS "read_scoped_chunks" ON document_chunks',
    'DROP POLICY IF EXISTS "insert_own_chunks" ON document_chunks',
    'DROP POLICY IF EXISTS "authenticated_read_knowledge_docs" ON knowledge_documents',
    'DROP POLICY IF EXISTS "authenticated_read_knowledge_chunks" ON knowledge_chunks',
    'DROP POLICY IF EXISTS "service_write_knowledge_docs" ON knowledge_documents',
    'DROP POLICY IF EXISTS "service_write_knowledge_chunks" ON knowledge_chunks',
    'DROP POLICY IF EXISTS "consultant_own_project_docs" ON project_documents',
    'DROP POLICY IF EXISTS "consultant_own_project_chunks" ON project_chunks',
    'DROP POLICY IF EXISTS "user_own_waste_inventory" ON waste_inventory',
    'DROP POLICY IF EXISTS "user_own_invoice_lines" ON invoice_lines',
    'DROP POLICY IF EXISTS "user_own_alerts" ON compliance_alerts',
    'DROP POLICY IF EXISTS "user_own_savings" ON savings_opportunities',
    'DROP POLICY IF EXISTS "user_own_contracts" ON contracts',
    'DROP POLICY IF EXISTS "consultant_upload_documents" ON storage.objects',
    'DROP POLICY IF EXISTS "consultant_read_documents" ON storage.objects',
    'DROP POLICY IF EXISTS "consultant_delete_documents" ON storage.objects'
  ]
  LOOP
    BEGIN
      EXECUTE _sql;
    EXCEPTION WHEN undefined_table THEN NULL;
    END;
  END LOOP;
END;
$$;

-- ────────────────────────────────────────────────────────
-- PART A: Ensure projects table has all columns
-- ────────────────────────────────────────────────────────

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

-- Copy data from clients to projects (if clients table still exists)
DO $$
BEGIN
  BEGIN
    INSERT INTO projects (id, consultant_id, nombre, created_at)
    SELECT id, consultant_id, nombre, created_at
    FROM clients
    WHERE id NOT IN (SELECT id FROM projects)
    ON CONFLICT (id) DO NOTHING;
  EXCEPTION WHEN undefined_table THEN
    RAISE NOTICE 'clients table not found, skipping';
  WHEN undefined_column THEN
    RAISE NOTICE 'clients columns mismatch, skipping';
  END;
END;
$$;

ALTER TABLE projects DROP COLUMN IF EXISTS client_id;

-- ────────────────────────────────────────────────────────
-- PART B: Create knowledge_documents + knowledge_chunks
-- ────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS knowledge_documents (
  id                    TEXT PRIMARY KEY,
  titulo                TEXT NOT NULL,
  tipo                  TEXT NOT NULL,
  naturaleza_pdf        TEXT,
  total_paginas         INT,
  total_chunks          INT,
  tablas_encontradas    INT DEFAULT 0,
  ocr_aplicado          BOOLEAN DEFAULT false,
  ocr_confianza_media   DECIMAL(4,3),
  fue_encriptado        BOOLEAN DEFAULT false,
  storage_path          TEXT,
  advertencias          TEXT[] DEFAULT '{}',
  metadata              JSONB DEFAULT '{}',
  estado                TEXT DEFAULT 'indexado'
    CHECK (estado IN ('procesando','indexado','error','pendiente')),
  fecha_documento       DATE,
  fecha_ingesta         TIMESTAMPTZ DEFAULT now(),
  drive_file_id         TEXT,

  CONSTRAINT valid_knowledge_tipo CHECK (tipo IN (
    'legislacion','documentacion_tecnica','gestores_residuos',
    'clasificacion_residuos','gestion_operativa','herramientas_plantillas',
    'referencia','desconocido'
  ))
);

CREATE INDEX IF NOT EXISTS idx_knowledge_docs_tipo ON knowledge_documents(tipo);
CREATE INDEX IF NOT EXISTS idx_knowledge_docs_drive ON knowledge_documents(drive_file_id)
  WHERE drive_file_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS knowledge_chunks (
  id            TEXT PRIMARY KEY,
  document_id   TEXT REFERENCES knowledge_documents(id) ON DELETE CASCADE,
  chunk_index   INT NOT NULL,
  contenido     TEXT NOT NULL,
  embedding     VECTOR(1536),
  chunk_type    TEXT,
  page_start    INT,
  page_end      INT,
  tokens        INT,
  metadata      JSONB DEFAULT '{}'
);

CREATE INDEX IF NOT EXISTS idx_knowledge_chunks_embedding ON knowledge_chunks
  USING hnsw (embedding vector_cosine_ops);

CREATE INDEX IF NOT EXISTS idx_knowledge_chunks_document ON knowledge_chunks(document_id);
CREATE INDEX IF NOT EXISTS idx_knowledge_chunks_type ON knowledge_chunks(chunk_type);

-- ────────────────────────────────────────────────────────
-- PART C: Create project_documents + project_chunks
-- ────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS project_documents (
  id                    TEXT PRIMARY KEY,
  project_id            UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  titulo                TEXT NOT NULL,
  tipo                  TEXT NOT NULL,
  naturaleza_pdf        TEXT,
  total_paginas         INT,
  total_chunks          INT,
  tablas_encontradas    INT DEFAULT 0,
  ocr_aplicado          BOOLEAN DEFAULT false,
  ocr_confianza_media   DECIMAL(4,3),
  fue_encriptado        BOOLEAN DEFAULT false,
  storage_path          TEXT,
  advertencias          TEXT[] DEFAULT '{}',
  metadata              JSONB DEFAULT '{}',
  estado                TEXT DEFAULT 'indexado'
    CHECK (estado IN ('procesando','indexado','error','pendiente')),
  fecha_documento       DATE,
  fecha_vencimiento     DATE,
  fecha_ingesta         TIMESTAMPTZ DEFAULT now(),

  CONSTRAINT valid_project_tipo CHECK (tipo IN (
    'autorizacion_ambiental_integrada','declaracion_anual_residuos',
    'contrato_gestor','factura','registro_produccion',
    'permiso_ambiental','manual_interno','desconocido',
    'costes_anuales','inventario_ler','comparativa_gestores',
    'facturas_agregadas','presupuesto'
  ))
);

CREATE INDEX IF NOT EXISTS idx_project_docs_project ON project_documents(project_id);
CREATE INDEX IF NOT EXISTS idx_project_docs_tipo ON project_documents(tipo);
CREATE INDEX IF NOT EXISTS idx_project_docs_vencimiento ON project_documents(fecha_vencimiento)
  WHERE fecha_vencimiento IS NOT NULL;

CREATE TABLE IF NOT EXISTS project_chunks (
  id            TEXT PRIMARY KEY,
  document_id   TEXT REFERENCES project_documents(id) ON DELETE CASCADE,
  project_id    UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  chunk_index   INT NOT NULL,
  contenido     TEXT NOT NULL,
  embedding     VECTOR(1536),
  chunk_type    TEXT,
  page_start    INT,
  page_end      INT,
  tokens        INT,
  metadata      JSONB DEFAULT '{}'
);

CREATE INDEX IF NOT EXISTS idx_project_chunks_embedding ON project_chunks
  USING hnsw (embedding vector_cosine_ops);

CREATE INDEX IF NOT EXISTS idx_project_chunks_document ON project_chunks(document_id);
CREATE INDEX IF NOT EXISTS idx_project_chunks_project ON project_chunks(project_id);
CREATE INDEX IF NOT EXISTS idx_project_chunks_type ON project_chunks(chunk_type);

-- ────────────────────────────────────────────────────────
-- PART D: Migrate data from old tables to new tables
-- ────────────────────────────────────────────────────────

DO $$
DECLARE
  _has_old_docs BOOLEAN;
  _has_old_chunks BOOLEAN;
  _col_name TEXT;
BEGIN
  -- Check if old tables exist
  SELECT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'client_documents'
  ) INTO _has_old_docs;

  SELECT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'document_chunks'
  ) INTO _has_old_chunks;

  IF NOT _has_old_docs THEN
    RAISE NOTICE 'client_documents not found, skipping data migration';
    RETURN;
  END IF;

  -- Determine which column holds the project reference
  SELECT column_name INTO _col_name
  FROM information_schema.columns
  WHERE table_schema = 'public' AND table_name = 'client_documents'
    AND column_name IN ('project_id', 'client_id')
  LIMIT 1;

  IF _col_name IS NULL THEN
    _col_name := 'project_id'; -- fallback
  END IF;

  -- ── Migrate general docs (normativa) → knowledge_documents ──
  -- General docs: project_id IS NULL or rag_scope = 'general' or tipo = 'normativa'
  EXECUTE format('
    INSERT INTO knowledge_documents (
      id, titulo, tipo, naturaleza_pdf, total_paginas, total_chunks,
      tablas_encontradas, ocr_aplicado, ocr_confianza_media, fue_encriptado,
      storage_path, advertencias, metadata, estado, fecha_documento,
      fecha_ingesta, drive_file_id
    )
    SELECT
      id, titulo,
      CASE
        WHEN tipo = ''normativa'' THEN ''legislacion''
        WHEN tipo = ''directiva'' THEN ''legislacion''
        WHEN tipo = ''bref'' THEN ''documentacion_tecnica''
        WHEN tipo = ''reglamento'' THEN ''legislacion''
        WHEN tipo = ''guia'' THEN ''referencia''
        ELSE ''desconocido''
      END AS tipo,
      naturaleza_pdf, total_paginas, total_chunks,
      tablas_encontradas, ocr_aplicado, ocr_confianza_media, fue_encriptado,
      storage_path, advertencias, metadata, estado, fecha_documento,
      fecha_ingesta, drive_file_id
    FROM client_documents
    WHERE %I IS NULL OR tipo = ''normativa''
    ON CONFLICT (id) DO NOTHING
  ', _col_name);

  RAISE NOTICE 'Migrated general docs to knowledge_documents';

  -- ── Migrate project docs → project_documents ──
  EXECUTE format('
    INSERT INTO project_documents (
      id, project_id, titulo, tipo, naturaleza_pdf, total_paginas, total_chunks,
      tablas_encontradas, ocr_aplicado, ocr_confianza_media, fue_encriptado,
      storage_path, advertencias, metadata, estado, fecha_documento,
      fecha_vencimiento, fecha_ingesta
    )
    SELECT
      id, %I, titulo, tipo, naturaleza_pdf, total_paginas, total_chunks,
      tablas_encontradas, ocr_aplicado, ocr_confianza_media, fue_encriptado,
      storage_path, advertencias, metadata, estado, fecha_documento,
      fecha_vencimiento, fecha_ingesta
    FROM client_documents
    WHERE %I IS NOT NULL AND tipo != ''normativa''
    ON CONFLICT (id) DO NOTHING
  ', _col_name, _col_name);

  RAISE NOTICE 'Migrated project docs to project_documents';

  -- ── Migrate chunks ──
  IF _has_old_chunks THEN
    -- Knowledge chunks (from general docs)
    INSERT INTO knowledge_chunks (
      id, document_id, chunk_index, contenido, embedding,
      chunk_type, page_start, page_end, tokens, metadata
    )
    SELECT
      dc.id, dc.document_id, dc.chunk_index, dc.contenido, dc.embedding,
      dc.chunk_type, dc.page_start, dc.page_end, dc.tokens, dc.metadata
    FROM document_chunks dc
    WHERE dc.document_id IN (SELECT id FROM knowledge_documents)
    ON CONFLICT (id) DO NOTHING;

    RAISE NOTICE 'Migrated knowledge chunks';

    -- Project chunks (from project docs)
    INSERT INTO project_chunks (
      id, document_id, project_id, chunk_index, contenido, embedding,
      chunk_type, page_start, page_end, tokens, metadata
    )
    SELECT
      dc.id, dc.document_id, pd.project_id,
      dc.chunk_index, dc.contenido, dc.embedding,
      dc.chunk_type, dc.page_start, dc.page_end, dc.tokens, dc.metadata
    FROM document_chunks dc
    JOIN project_documents pd ON dc.document_id = pd.id
    ON CONFLICT (id) DO NOTHING;

    RAISE NOTICE 'Migrated project chunks';
  END IF;
END;
$$;

-- ────────────────────────────────────────────────────────
-- PART E: Update FKs in secondary tables
-- ────────────────────────────────────────────────────────

-- Rename client_id → project_id in secondary tables (if still needed)
DO $$
DECLARE
  _tbl TEXT;
  _old_fk TEXT;
BEGIN
  FOREACH _tbl IN ARRAY ARRAY[
    'waste_inventory', 'invoice_lines',
    'compliance_alerts', 'savings_opportunities', 'contracts'
  ]
  LOOP
    IF EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = _tbl AND column_name = 'client_id'
    ) THEN
      _old_fk := _tbl || '_client_id_fkey';
      EXECUTE format('ALTER TABLE %I DROP CONSTRAINT IF EXISTS %I', _tbl, _old_fk);
      EXECUTE format('ALTER TABLE %I RENAME COLUMN client_id TO project_id', _tbl);
    END IF;

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
        RAISE NOTICE 'FK on %.project_id: %', _tbl, SQLERRM;
      END;
    END IF;
  END LOOP;
END;
$$;

-- Update doc_id FKs: point to project_documents instead of client_documents
DO $$
BEGIN
  -- waste_inventory.fuente_doc_id
  ALTER TABLE waste_inventory DROP CONSTRAINT IF EXISTS waste_inventory_fuente_doc_id_fkey;
  BEGIN
    ALTER TABLE waste_inventory ADD CONSTRAINT waste_inventory_fuente_doc_id_fkey
      FOREIGN KEY (fuente_doc_id) REFERENCES project_documents(id) ON DELETE SET NULL;
  EXCEPTION WHEN others THEN
    RAISE NOTICE 'waste_inventory.fuente_doc_id FK: %', SQLERRM;
  END;

  -- invoice_lines.doc_id
  ALTER TABLE invoice_lines DROP CONSTRAINT IF EXISTS invoice_lines_doc_id_fkey;
  BEGIN
    ALTER TABLE invoice_lines ADD CONSTRAINT invoice_lines_doc_id_fkey
      FOREIGN KEY (doc_id) REFERENCES project_documents(id) ON DELETE SET NULL;
  EXCEPTION WHEN others THEN
    RAISE NOTICE 'invoice_lines.doc_id FK: %', SQLERRM;
  END;

  -- compliance_alerts.doc_id
  ALTER TABLE compliance_alerts DROP CONSTRAINT IF EXISTS compliance_alerts_doc_id_fkey;
  BEGIN
    ALTER TABLE compliance_alerts ADD CONSTRAINT compliance_alerts_doc_id_fkey
      FOREIGN KEY (doc_id) REFERENCES project_documents(id) ON DELETE SET NULL;
  EXCEPTION WHEN others THEN
    RAISE NOTICE 'compliance_alerts.doc_id FK: %', SQLERRM;
  END;
END;
$$;

-- ────────────────────────────────────────────────────────
-- PART F: Create new functions, views, RLS
-- ────────────────────────────────────────────────────────

-- Functions
CREATE OR REPLACE FUNCTION search_knowledge(
  query_embedding VECTOR(1536), doc_type_filter TEXT DEFAULT NULL,
  match_threshold FLOAT DEFAULT 0.70, match_count INT DEFAULT 5
)
RETURNS TABLE (
  chunk_id TEXT, document_id TEXT, contenido TEXT, chunk_type TEXT,
  similarity FLOAT, doc_titulo TEXT, doc_tipo TEXT, doc_metadata JSONB, storage_path TEXT
)
LANGUAGE SQL STABLE AS $$
  SELECT kc.id, kc.document_id, kc.contenido, kc.chunk_type,
    1 - (kc.embedding <=> query_embedding) AS similarity,
    kd.titulo, kd.tipo, kd.metadata, kd.storage_path
  FROM knowledge_chunks kc
  JOIN knowledge_documents kd ON kc.document_id = kd.id
  WHERE (doc_type_filter IS NULL OR kd.tipo = doc_type_filter)
    AND 1 - (kc.embedding <=> query_embedding) > match_threshold
  ORDER BY kc.embedding <=> query_embedding
  LIMIT match_count;
$$;

CREATE OR REPLACE FUNCTION search_project(
  query_embedding VECTOR(1536), p_project_id UUID,
  doc_type_filter TEXT DEFAULT NULL,
  match_threshold FLOAT DEFAULT 0.70, match_count INT DEFAULT 5
)
RETURNS TABLE (
  chunk_id TEXT, document_id TEXT, contenido TEXT, chunk_type TEXT,
  similarity FLOAT, doc_titulo TEXT, doc_tipo TEXT, doc_metadata JSONB, storage_path TEXT
)
LANGUAGE SQL STABLE AS $$
  SELECT pc.id, pc.document_id, pc.contenido, pc.chunk_type,
    1 - (pc.embedding <=> query_embedding) AS similarity,
    pd.titulo, pd.tipo, pd.metadata, pd.storage_path
  FROM project_chunks pc
  JOIN project_documents pd ON pc.document_id = pd.id
  WHERE pc.project_id = p_project_id
    AND (doc_type_filter IS NULL OR pd.tipo = doc_type_filter)
    AND 1 - (pc.embedding <=> query_embedding) > match_threshold
  ORDER BY pc.embedding <=> query_embedding
  LIMIT match_count;
$$;

CREATE OR REPLACE FUNCTION search_combined(
  query_embedding VECTOR(1536), p_project_id UUID DEFAULT NULL,
  doc_type_filter TEXT DEFAULT NULL, match_threshold FLOAT DEFAULT 0.70,
  match_count_kb INT DEFAULT 5, match_count_project INT DEFAULT 5
)
RETURNS TABLE (
  chunk_id TEXT, document_id TEXT, contenido TEXT, chunk_type TEXT,
  similarity FLOAT, doc_titulo TEXT, doc_tipo TEXT, doc_metadata JSONB,
  storage_path TEXT, source TEXT
)
LANGUAGE SQL STABLE AS $$
  (
    SELECT kc.id, kc.document_id, kc.contenido, kc.chunk_type,
      1 - (kc.embedding <=> query_embedding), kd.titulo, kd.tipo, kd.metadata,
      kd.storage_path, 'knowledge'::TEXT
    FROM knowledge_chunks kc JOIN knowledge_documents kd ON kc.document_id = kd.id
    WHERE (doc_type_filter IS NULL OR kd.tipo = doc_type_filter)
      AND 1 - (kc.embedding <=> query_embedding) > match_threshold
    ORDER BY kc.embedding <=> query_embedding LIMIT match_count_kb
  )
  UNION ALL
  (
    SELECT pc.id, pc.document_id, pc.contenido, pc.chunk_type,
      1 - (pc.embedding <=> query_embedding), pd.titulo, pd.tipo, pd.metadata,
      pd.storage_path, 'project'::TEXT
    FROM project_chunks pc JOIN project_documents pd ON pc.document_id = pd.id
    WHERE p_project_id IS NOT NULL AND pc.project_id = p_project_id
      AND (doc_type_filter IS NULL OR pd.tipo = doc_type_filter)
      AND 1 - (pc.embedding <=> query_embedding) > match_threshold
    ORDER BY pc.embedding <=> query_embedding LIMIT match_count_project
  )
  ORDER BY 5 DESC;
$$;

-- Views
CREATE OR REPLACE VIEW knowledge_stats AS
SELECT kd.tipo AS doc_type, COUNT(DISTINCT kd.id) AS num_documents,
  COUNT(kc.id) AS num_chunks, AVG(kc.tokens) AS avg_tokens_per_chunk,
  MAX(kd.fecha_ingesta) AS last_ingestion
FROM knowledge_chunks kc JOIN knowledge_documents kd ON kc.document_id = kd.id
WHERE kc.embedding IS NOT NULL GROUP BY kd.tipo;

CREATE OR REPLACE VIEW project_stats AS
SELECT pd.project_id, pd.tipo AS doc_type, COUNT(DISTINCT pd.id) AS num_documents,
  COUNT(pc.id) AS num_chunks, AVG(pc.tokens) AS avg_tokens_per_chunk,
  MAX(pd.fecha_ingesta) AS last_ingestion
FROM project_chunks pc JOIN project_documents pd ON pc.document_id = pd.id
WHERE pc.embedding IS NOT NULL GROUP BY pd.project_id, pd.tipo;

-- RLS
ALTER TABLE projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE knowledge_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE knowledge_chunks ENABLE ROW LEVEL SECURITY;
ALTER TABLE project_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE project_chunks ENABLE ROW LEVEL SECURITY;
ALTER TABLE waste_inventory ENABLE ROW LEVEL SECURITY;
ALTER TABLE invoice_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE compliance_alerts ENABLE ROW LEVEL SECURITY;
ALTER TABLE savings_opportunities ENABLE ROW LEVEL SECURITY;
ALTER TABLE contracts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "consultant_own_projects" ON projects;
CREATE POLICY "consultant_own_projects" ON projects
  FOR ALL USING (consultant_id = auth.uid());

DROP POLICY IF EXISTS "authenticated_read_knowledge_docs" ON knowledge_documents;
CREATE POLICY "authenticated_read_knowledge_docs" ON knowledge_documents
  FOR SELECT USING (auth.role() = 'authenticated');
DROP POLICY IF EXISTS "service_write_knowledge_docs" ON knowledge_documents;
CREATE POLICY "service_write_knowledge_docs" ON knowledge_documents
  FOR ALL USING (auth.role() = 'service_role');

DROP POLICY IF EXISTS "authenticated_read_knowledge_chunks" ON knowledge_chunks;
CREATE POLICY "authenticated_read_knowledge_chunks" ON knowledge_chunks
  FOR SELECT USING (auth.role() = 'authenticated');
DROP POLICY IF EXISTS "service_write_knowledge_chunks" ON knowledge_chunks;
CREATE POLICY "service_write_knowledge_chunks" ON knowledge_chunks
  FOR ALL USING (auth.role() = 'service_role');

DROP POLICY IF EXISTS "consultant_own_project_docs" ON project_documents;
CREATE POLICY "consultant_own_project_docs" ON project_documents
  FOR ALL USING (project_id IN (SELECT id FROM projects WHERE consultant_id = auth.uid()));

DROP POLICY IF EXISTS "consultant_own_project_chunks" ON project_chunks;
CREATE POLICY "consultant_own_project_chunks" ON project_chunks
  FOR ALL USING (project_id IN (SELECT id FROM projects WHERE consultant_id = auth.uid()));

DROP POLICY IF EXISTS "user_own_waste_inventory" ON waste_inventory;
CREATE POLICY "user_own_waste_inventory" ON waste_inventory
  FOR ALL USING (project_id IN (SELECT id FROM projects WHERE consultant_id = auth.uid()));

DROP POLICY IF EXISTS "user_own_invoice_lines" ON invoice_lines;
CREATE POLICY "user_own_invoice_lines" ON invoice_lines
  FOR ALL USING (project_id IN (SELECT id FROM projects WHERE consultant_id = auth.uid()));

DROP POLICY IF EXISTS "user_own_alerts" ON compliance_alerts;
CREATE POLICY "user_own_alerts" ON compliance_alerts
  FOR ALL USING (project_id IN (SELECT id FROM projects WHERE consultant_id = auth.uid()));

DROP POLICY IF EXISTS "user_own_savings" ON savings_opportunities;
CREATE POLICY "user_own_savings" ON savings_opportunities
  FOR ALL USING (project_id IN (SELECT id FROM projects WHERE consultant_id = auth.uid()));

DROP POLICY IF EXISTS "authenticated_read_managers" ON waste_managers;
CREATE POLICY "authenticated_read_managers" ON waste_managers
  FOR SELECT USING (auth.role() = 'authenticated');

DROP POLICY IF EXISTS "user_own_contracts" ON contracts;
CREATE POLICY "user_own_contracts" ON contracts
  FOR ALL USING (project_id IN (SELECT id FROM projects WHERE consultant_id = auth.uid()));

DROP POLICY IF EXISTS "consultant_upload_documents" ON storage.objects;
CREATE POLICY "consultant_upload_documents" ON storage.objects
  FOR INSERT WITH CHECK (
    bucket_id = 'documentos' AND (
      (storage.foldername(name))[1] = 'general'
      OR (storage.foldername(name))[1] IN (
        SELECT id::text FROM projects WHERE consultant_id = auth.uid()
      )
    )
  );

DROP POLICY IF EXISTS "consultant_read_documents" ON storage.objects;
CREATE POLICY "consultant_read_documents" ON storage.objects
  FOR SELECT USING (
    bucket_id = 'documentos' AND (
      (storage.foldername(name))[1] = 'general'
      OR (storage.foldername(name))[1] IN (
        SELECT id::text FROM projects WHERE consultant_id = auth.uid()
      )
    )
  );

DROP POLICY IF EXISTS "consultant_delete_documents" ON storage.objects;
CREATE POLICY "consultant_delete_documents" ON storage.objects
  FOR DELETE USING (
    bucket_id = 'documentos' AND (
      (storage.foldername(name))[1] = 'general'
      OR (storage.foldername(name))[1] IN (
        SELECT id::text FROM projects WHERE consultant_id = auth.uid()
      )
    )
  );

-- ────────────────────────────────────────────────────────
-- PART G: Drop old tables
-- ────────────────────────────────────────────────────────
DROP TABLE IF EXISTS document_chunks CASCADE;
DROP TABLE IF EXISTS client_documents CASCADE;
DROP TABLE IF EXISTS clients CASCADE;

-- ────────────────────────────────────────────────────────
-- VERIFICATION (uncomment to run)
-- ────────────────────────────────────────────────────────
-- SELECT 'knowledge_documents' AS tabla, COUNT(*) FROM knowledge_documents
-- UNION ALL SELECT 'knowledge_chunks', COUNT(*) FROM knowledge_chunks
-- UNION ALL SELECT 'project_documents', COUNT(*) FROM project_documents
-- UNION ALL SELECT 'project_chunks', COUNT(*) FROM project_chunks;
