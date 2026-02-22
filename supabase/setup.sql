-- ================================================================
-- SETUP COMPLETO SUPABASE - ResidusIA Pro
-- ================================================================
-- Ejecutar en Supabase SQL Editor en una sola ejecución.
--
-- Modelo de datos:
--   projects = entidad única (empresa + trabajo)
--   DOS RAGs completamente separados:
--     knowledge_documents + knowledge_chunks → normativa, BREFs, directivas (de Google Drive)
--     project_documents   + project_chunks   → docs del proyecto (facturas, AAI, contratos...)
--
-- Orden: extensiones → bucket → projects →
--        knowledge (docs+chunks) → project (docs+chunks) →
--        tablas secundarias → funciones RAG → vistas → RLS → realtime → storage
-- ================================================================

-- ════════════════════════════════════════════════════════════════
-- 1. EXTENSIONES
-- ════════════════════════════════════════════════════════════════
CREATE EXTENSION IF NOT EXISTS vector;

-- ════════════════════════════════════════════════════════════════
-- 2. BUCKET DE STORAGE (documentos originales)
-- ════════════════════════════════════════════════════════════════
-- Estructura: general/Normativa/{filename}
--             {project_id}/{tipo_doc}/{filename}
INSERT INTO storage.buckets (id, name, public)
VALUES ('documentos', 'documentos', false)
ON CONFLICT (id) DO NOTHING;

-- ════════════════════════════════════════════════════════════════
-- 3. TABLA PRINCIPAL: PROYECTOS
-- ════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS projects (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  consultant_id     UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  nombre            TEXT NOT NULL,
  cif               TEXT,
  cnae              TEXT,
  sector            TEXT,
  comunidad_autonoma TEXT,
  municipio         TEXT,
  direccion         TEXT,
  contacto_nombre   TEXT,
  contacto_email    TEXT,
  contacto_telefono TEXT,
  notas             TEXT,
  tipo              TEXT CHECK (tipo IN (
    'diagnostico_inicial', 'retainer_anual', 'auditoria', 'optimizacion_puntual'
  )),
  estado            TEXT DEFAULT 'activo'
    CHECK (estado IN ('activo','completado','pausado')),
  descripcion       TEXT,
  fecha_inicio      DATE DEFAULT CURRENT_DATE,
  fecha_fin         DATE,
  metadata          JSONB DEFAULT '{}',
  created_at        TIMESTAMPTZ DEFAULT now(),
  updated_at        TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_projects_consultant ON projects(consultant_id);

-- ════════════════════════════════════════════════════════════════
-- 4. RAG GENERAL: Base de conocimiento (normativa, BREFs, directivas)
--    Documentos de Google Drive. Sin proyecto. Accesibles por todos.
-- ════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS knowledge_documents (
  id                    TEXT PRIMARY KEY,        -- kb_{sha256_16}
  titulo                TEXT NOT NULL,
  tipo                  TEXT NOT NULL,
  naturaleza_pdf        TEXT,                    -- digital/scanned/hybrid/encrypted
  total_paginas         INT,
  total_chunks          INT,
  tablas_encontradas    INT DEFAULT 0,
  ocr_aplicado          BOOLEAN DEFAULT false,
  ocr_confianza_media   DECIMAL(4,3),
  fue_encriptado        BOOLEAN DEFAULT false,
  storage_path          TEXT,                    -- general/Normativa/{filename}
  advertencias          TEXT[] DEFAULT '{}',
  metadata              JSONB DEFAULT '{}',
  estado                TEXT DEFAULT 'indexado'
    CHECK (estado IN ('procesando','indexado','error','pendiente')),
  fecha_documento       DATE,
  fecha_ingesta         TIMESTAMPTZ DEFAULT now(),
  drive_file_id         TEXT,                    -- enlace a Google Drive

  CONSTRAINT valid_knowledge_tipo CHECK (tipo IN (
    'legislacion','documentacion_tecnica','gestores_residuos',
    'clasificacion_residuos','gestion_operativa','herramientas_plantillas',
    'referencia','desconocido'
  ))
);

CREATE INDEX idx_knowledge_docs_tipo ON knowledge_documents(tipo);
CREATE INDEX idx_knowledge_docs_drive ON knowledge_documents(drive_file_id)
  WHERE drive_file_id IS NOT NULL;

-- Chunks de conocimiento general (embeddings para RAG)
CREATE TABLE IF NOT EXISTS knowledge_chunks (
  id            TEXT PRIMARY KEY,                -- {doc_id}_chunk_{index}
  document_id   TEXT REFERENCES knowledge_documents(id) ON DELETE CASCADE,
  chunk_index   INT NOT NULL,
  contenido     TEXT NOT NULL,
  embedding     VECTOR(1536),                    -- OpenAI text-embedding-3-large
  chunk_type    TEXT,                            -- texto/tabla/seccion/articulo
  page_start    INT,
  page_end      INT,
  tokens        INT,
  metadata      JSONB DEFAULT '{}'
);

CREATE INDEX idx_knowledge_chunks_embedding ON knowledge_chunks
  USING hnsw (embedding vector_cosine_ops);

CREATE INDEX idx_knowledge_chunks_document ON knowledge_chunks(document_id);
CREATE INDEX idx_knowledge_chunks_type ON knowledge_chunks(chunk_type);

-- ════════════════════════════════════════════════════════════════
-- 5. RAG PROYECTO: Documentos de cada proyecto
--    Facturas, AAI, contratos, declaraciones... Privados por proyecto.
-- ════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS project_documents (
  id                    TEXT PRIMARY KEY,        -- doc_{sha256_16}
  project_id            UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  titulo                TEXT NOT NULL,
  tipo                  TEXT NOT NULL,
  naturaleza_pdf        TEXT,                    -- digital/scanned/hybrid/encrypted/excel
  total_paginas         INT,
  total_chunks          INT,
  tablas_encontradas    INT DEFAULT 0,
  ocr_aplicado          BOOLEAN DEFAULT false,
  ocr_confianza_media   DECIMAL(4,3),
  fue_encriptado        BOOLEAN DEFAULT false,
  storage_path          TEXT,                    -- {project_id}/{tipo}/{filename}
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

CREATE INDEX idx_project_docs_project ON project_documents(project_id);
CREATE INDEX idx_project_docs_tipo ON project_documents(tipo);
CREATE INDEX idx_project_docs_vencimiento ON project_documents(fecha_vencimiento)
  WHERE fecha_vencimiento IS NOT NULL;

-- Chunks de proyecto (embeddings para RAG)
CREATE TABLE IF NOT EXISTS project_chunks (
  id            TEXT PRIMARY KEY,                -- {doc_id}_chunk_{index}
  document_id   TEXT REFERENCES project_documents(id) ON DELETE CASCADE,
  project_id    UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  chunk_index   INT NOT NULL,
  contenido     TEXT NOT NULL,
  embedding     VECTOR(1536),                    -- OpenAI text-embedding-3-large
  chunk_type    TEXT,                            -- texto/tabla/seccion/clausula/linea_factura
  page_start    INT,
  page_end      INT,
  tokens        INT,
  metadata      JSONB DEFAULT '{}'
);

CREATE INDEX idx_project_chunks_embedding ON project_chunks
  USING hnsw (embedding vector_cosine_ops);

CREATE INDEX idx_project_chunks_document ON project_chunks(document_id);
CREATE INDEX idx_project_chunks_project ON project_chunks(project_id);
CREATE INDEX idx_project_chunks_type ON project_chunks(chunk_type);

-- ════════════════════════════════════════════════════════════════
-- 6. TABLAS SECUNDARIAS (datos estructurados de proyecto)
-- ════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS waste_inventory (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id            UUID REFERENCES projects(id) ON DELETE CASCADE,
  codigo_ler            TEXT,
  descripcion           TEXT,
  peligroso             BOOLEAN DEFAULT false,
  cantidad_anual_ton    DECIMAL(10,3),
  precio_actual_eur_ton DECIMAL(10,2),
  operacion             TEXT,
  gestor_actual         TEXT,
  frecuencia_recogida   TEXT,
  fuente_doc_id         TEXT REFERENCES project_documents(id),
  año                   INT,
  created_at            TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_waste_inv_project ON waste_inventory(project_id);
CREATE INDEX idx_waste_inv_ler ON waste_inventory(codigo_ler);

CREATE TABLE IF NOT EXISTS invoice_lines (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id          UUID REFERENCES projects(id) ON DELETE CASCADE,
  doc_id              TEXT REFERENCES project_documents(id),
  fecha               DATE,
  codigo_ler          TEXT,
  descripcion         TEXT,
  cantidad_toneladas  DECIMAL(10,3),
  precio_unitario     DECIMAL(10,2),
  importe_eur         DECIMAL(10,2),
  created_at          TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_invoice_lines_project ON invoice_lines(project_id);
CREATE INDEX idx_invoice_lines_ler ON invoice_lines(codigo_ler);
CREATE INDEX idx_invoice_lines_fecha ON invoice_lines(fecha);

CREATE TABLE IF NOT EXISTS compliance_alerts (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id    UUID REFERENCES projects(id) ON DELETE CASCADE,
  tipo          TEXT NOT NULL,
  descripcion   TEXT NOT NULL,
  severidad     TEXT CHECK (severidad IN ('baja','media','alta','critica')),
  doc_id        TEXT REFERENCES project_documents(id),
  estado        TEXT DEFAULT 'pendiente'
    CHECK (estado IN ('pendiente','vista','resuelta','descartada')),
  fecha_limite  DATE,
  created_at    TIMESTAMPTZ DEFAULT now(),
  resolved_at   TIMESTAMPTZ
);

CREATE INDEX idx_alerts_project ON compliance_alerts(project_id);
CREATE INDEX idx_alerts_estado ON compliance_alerts(estado);
CREATE INDEX idx_alerts_severidad ON compliance_alerts(severidad);

CREATE TABLE IF NOT EXISTS savings_opportunities (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id              UUID REFERENCES projects(id) ON DELETE CASCADE,
  waste_id                UUID REFERENCES waste_inventory(id),
  tipo                    TEXT NOT NULL,
  descripcion             TEXT NOT NULL,
  ahorro_estimado_eur_año DECIMAL(10,2),
  inversion_necesaria     DECIMAL(10,2),
  payback_meses           INT,
  norma_aplicable         TEXT,
  estado                  TEXT DEFAULT 'detectada'
    CHECK (estado IN ('detectada','propuesta','aceptada','implementada','descartada')),
  ia_generada             BOOLEAN DEFAULT false,
  created_at              TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_savings_project ON savings_opportunities(project_id);
CREATE INDEX idx_savings_estado ON savings_opportunities(estado);

CREATE TABLE IF NOT EXISTS waste_managers (
  id                        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nombre                    TEXT NOT NULL,
  nif                       TEXT,
  numero_autorizacion       TEXT,
  ccaa_autorizacion         TEXT[],
  codigos_ler_autorizados   TEXT[],
  operaciones_autorizadas   TEXT[],
  precio_referencia_eur_ton DECIMAL(10,2),
  valoracion                DECIMAL(3,1),
  activo                    BOOLEAN DEFAULT true,
  created_at                TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS contracts (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id          UUID REFERENCES projects(id) ON DELETE CASCADE,
  manager_id          UUID REFERENCES waste_managers(id),
  fecha_inicio        DATE,
  fecha_vencimiento   DATE,
  codigos_ler         TEXT[],
  precio_eur_ton      DECIMAL(10,2),
  condiciones         JSONB DEFAULT '{}',
  storage_path        TEXT,
  alertar_dias_antes  INT DEFAULT 30,
  created_at          TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_contracts_project ON contracts(project_id);
CREATE INDEX idx_contracts_manager ON contracts(manager_id);
CREATE INDEX idx_contracts_vencimiento ON contracts(fecha_vencimiento)
  WHERE fecha_vencimiento IS NOT NULL;

-- ── Progreso del pipeline (UI en tiempo real) ──────────────────
CREATE TABLE IF NOT EXISTS pipeline_progress (
  doc_id      TEXT PRIMARY KEY,
  step        TEXT NOT NULL,
  percentage  INT CHECK (percentage BETWEEN 0 AND 100),
  mensaje     TEXT,
  error       TEXT,
  updated_at  TIMESTAMPTZ DEFAULT now()
);

-- ── Google Drive OAuth ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS consultant_gdrive (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  consultant_id     UUID REFERENCES auth.users(id) ON DELETE CASCADE UNIQUE,
  access_token      TEXT,
  refresh_token     TEXT,
  token_expiry      TIMESTAMPTZ,
  root_folder_id    TEXT,
  folder_mapping    JSONB DEFAULT '{}',
  last_synced_at    TIMESTAMPTZ,
  auto_sync_enabled BOOLEAN DEFAULT true,
  created_at        TIMESTAMPTZ DEFAULT now(),
  updated_at        TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS gdrive_sync_log (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  consultant_id     UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  status            TEXT NOT NULL DEFAULT 'running',
  started_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at      TIMESTAMPTZ,
  total_files_found INT DEFAULT 0,
  files_ingested    INT DEFAULT 0,
  files_skipped     INT DEFAULT 0,
  files_failed      INT DEFAULT 0,
  error_message     TEXT,
  details           JSONB DEFAULT '[]'::JSONB
);

CREATE INDEX idx_sync_log_consultant ON gdrive_sync_log(consultant_id, started_at DESC);

-- ════════════════════════════════════════════════════════════════
-- 7. FUNCIONES RAG
-- ════════════════════════════════════════════════════════════════

-- Búsqueda en RAG General (knowledge base)
CREATE OR REPLACE FUNCTION search_knowledge(
  query_embedding     VECTOR(1536),
  doc_type_filter     TEXT    DEFAULT NULL,
  match_threshold     FLOAT   DEFAULT 0.70,
  match_count         INT     DEFAULT 5
)
RETURNS TABLE (
  chunk_id      TEXT,
  document_id   TEXT,
  contenido     TEXT,
  chunk_type    TEXT,
  similarity    FLOAT,
  doc_titulo    TEXT,
  doc_tipo      TEXT,
  doc_metadata  JSONB,
  storage_path  TEXT
)
LANGUAGE SQL STABLE AS $$
  SELECT
    kc.id            AS chunk_id,
    kc.document_id,
    kc.contenido,
    kc.chunk_type,
    1 - (kc.embedding <=> query_embedding) AS similarity,
    kd.titulo        AS doc_titulo,
    kd.tipo          AS doc_tipo,
    kd.metadata      AS doc_metadata,
    kd.storage_path
  FROM knowledge_chunks kc
  JOIN knowledge_documents kd ON kc.document_id = kd.id
  WHERE
    (doc_type_filter IS NULL OR kd.tipo = doc_type_filter)
    AND 1 - (kc.embedding <=> query_embedding) > match_threshold
  ORDER BY kc.embedding <=> query_embedding
  LIMIT match_count;
$$;

-- Búsqueda en RAG de Proyecto
CREATE OR REPLACE FUNCTION search_project(
  query_embedding     VECTOR(1536),
  p_project_id        UUID,
  doc_type_filter     TEXT    DEFAULT NULL,
  match_threshold     FLOAT   DEFAULT 0.70,
  match_count         INT     DEFAULT 5
)
RETURNS TABLE (
  chunk_id      TEXT,
  document_id   TEXT,
  contenido     TEXT,
  chunk_type    TEXT,
  similarity    FLOAT,
  doc_titulo    TEXT,
  doc_tipo      TEXT,
  doc_metadata  JSONB,
  storage_path  TEXT
)
LANGUAGE SQL STABLE AS $$
  SELECT
    pc.id            AS chunk_id,
    pc.document_id,
    pc.contenido,
    pc.chunk_type,
    1 - (pc.embedding <=> query_embedding) AS similarity,
    pd.titulo        AS doc_titulo,
    pd.tipo          AS doc_tipo,
    pd.metadata      AS doc_metadata,
    pd.storage_path
  FROM project_chunks pc
  JOIN project_documents pd ON pc.document_id = pd.id
  WHERE
    pc.project_id = p_project_id
    AND (doc_type_filter IS NULL OR pd.tipo = doc_type_filter)
    AND 1 - (pc.embedding <=> query_embedding) > match_threshold
  ORDER BY pc.embedding <=> query_embedding
  LIMIT match_count;
$$;

-- Búsqueda combinada (ambos RAGs en una llamada)
CREATE OR REPLACE FUNCTION search_combined(
  query_embedding     VECTOR(1536),
  p_project_id        UUID    DEFAULT NULL,
  doc_type_filter     TEXT    DEFAULT NULL,
  match_threshold     FLOAT   DEFAULT 0.70,
  match_count_kb      INT     DEFAULT 5,
  match_count_project INT     DEFAULT 5
)
RETURNS TABLE (
  chunk_id      TEXT,
  document_id   TEXT,
  contenido     TEXT,
  chunk_type    TEXT,
  similarity    FLOAT,
  doc_titulo    TEXT,
  doc_tipo      TEXT,
  doc_metadata  JSONB,
  storage_path  TEXT,
  source        TEXT          -- 'knowledge' o 'project'
)
LANGUAGE SQL STABLE AS $$
  -- RAG General
  (
    SELECT kc.id, kc.document_id, kc.contenido, kc.chunk_type,
           1 - (kc.embedding <=> query_embedding) AS similarity,
           kd.titulo, kd.tipo, kd.metadata, kd.storage_path,
           'knowledge'::TEXT AS source
    FROM knowledge_chunks kc
    JOIN knowledge_documents kd ON kc.document_id = kd.id
    WHERE (doc_type_filter IS NULL OR kd.tipo = doc_type_filter)
      AND 1 - (kc.embedding <=> query_embedding) > match_threshold
    ORDER BY kc.embedding <=> query_embedding
    LIMIT match_count_kb
  )
  UNION ALL
  -- RAG Proyecto
  (
    SELECT pc.id, pc.document_id, pc.contenido, pc.chunk_type,
           1 - (pc.embedding <=> query_embedding) AS similarity,
           pd.titulo, pd.tipo, pd.metadata, pd.storage_path,
           'project'::TEXT AS source
    FROM project_chunks pc
    JOIN project_documents pd ON pc.document_id = pd.id
    WHERE p_project_id IS NOT NULL
      AND pc.project_id = p_project_id
      AND (doc_type_filter IS NULL OR pd.tipo = doc_type_filter)
      AND 1 - (pc.embedding <=> query_embedding) > match_threshold
    ORDER BY pc.embedding <=> query_embedding
    LIMIT match_count_project
  )
  ORDER BY similarity DESC;
$$;

-- ════════════════════════════════════════════════════════════════
-- 8. VISTAS
-- ════════════════════════════════════════════════════════════════

CREATE OR REPLACE VIEW knowledge_stats AS
SELECT
  kd.tipo                               AS doc_type,
  COUNT(DISTINCT kd.id)                 AS num_documents,
  COUNT(kc.id)                          AS num_chunks,
  AVG(kc.tokens)                        AS avg_tokens_per_chunk,
  MAX(kd.fecha_ingesta)                 AS last_ingestion
FROM knowledge_chunks kc
JOIN knowledge_documents kd ON kc.document_id = kd.id
WHERE kc.embedding IS NOT NULL
GROUP BY kd.tipo;

CREATE OR REPLACE VIEW project_stats AS
SELECT
  pd.project_id,
  pd.tipo                               AS doc_type,
  COUNT(DISTINCT pd.id)                 AS num_documents,
  COUNT(pc.id)                          AS num_chunks,
  AVG(pc.tokens)                        AS avg_tokens_per_chunk,
  MAX(pd.fecha_ingesta)                 AS last_ingestion
FROM project_chunks pc
JOIN project_documents pd ON pc.document_id = pd.id
WHERE pc.embedding IS NOT NULL
GROUP BY pd.project_id, pd.tipo;

-- ════════════════════════════════════════════════════════════════
-- 9. ROW LEVEL SECURITY
-- ════════════════════════════════════════════════════════════════

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

-- Proyectos: solo el consultor dueño
CREATE POLICY "consultant_own_projects" ON projects
  FOR ALL USING (consultant_id = auth.uid());

-- Knowledge: accesible por cualquier usuario autenticado (lectura)
CREATE POLICY "authenticated_read_knowledge_docs" ON knowledge_documents
  FOR SELECT USING (auth.role() = 'authenticated');

CREATE POLICY "authenticated_read_knowledge_chunks" ON knowledge_chunks
  FOR SELECT USING (auth.role() = 'authenticated');

-- Knowledge: solo service_role puede insertar/modificar (pipeline backend)
CREATE POLICY "service_write_knowledge_docs" ON knowledge_documents
  FOR ALL USING (auth.role() = 'service_role');

CREATE POLICY "service_write_knowledge_chunks" ON knowledge_chunks
  FOR ALL USING (auth.role() = 'service_role');

-- Project docs: solo el consultor dueño del proyecto
CREATE POLICY "consultant_own_project_docs" ON project_documents
  FOR ALL USING (
    project_id IN (SELECT id FROM projects WHERE consultant_id = auth.uid())
  );

CREATE POLICY "consultant_own_project_chunks" ON project_chunks
  FOR ALL USING (
    project_id IN (SELECT id FROM projects WHERE consultant_id = auth.uid())
  );

-- Tablas secundarias: solo el consultor dueño del proyecto
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

CREATE POLICY "authenticated_read_managers" ON waste_managers
  FOR SELECT USING (auth.role() = 'authenticated');

CREATE POLICY "user_own_contracts" ON contracts
  FOR ALL USING (
    project_id IN (SELECT id FROM projects WHERE consultant_id = auth.uid())
  );

-- ════════════════════════════════════════════════════════════════
-- 10. STORAGE POLICIES (bucket "documentos")
-- ════════════════════════════════════════════════════════════════

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

-- ════════════════════════════════════════════════════════════════
-- 11. REALTIME
-- ════════════════════════════════════════════════════════════════

ALTER PUBLICATION supabase_realtime ADD TABLE pipeline_progress;
ALTER PUBLICATION supabase_realtime ADD TABLE compliance_alerts;
ALTER PUBLICATION supabase_realtime ADD TABLE projects;
