-- ================================================================
-- SETUP COMPLETO SUPABASE - ResidusIA Pro
-- ================================================================
-- Ejecutar en Supabase SQL Editor en una sola ejecución.
--
-- Modelo de datos:
--   projects = entidad única (empresa + trabajo)
--   Dos RAGs separados:
--     general → normativa, BREFs, directivas (sin project_id)
--     project → documentos del proyecto (con project_id)
--
-- Orden: extensiones → bucket → projects →
--        client_documents → document_chunks → tablas secundarias →
--        funciones RAG → vistas → RLS → realtime → storage policies
-- ================================================================

-- ════════════════════════════════════════════════════════════════
-- 1. EXTENSIONES
-- ════════════════════════════════════════════════════════════════
CREATE EXTENSION IF NOT EXISTS vector;

-- ════════════════════════════════════════════════════════════════
-- 2. BUCKET DE STORAGE (documentos originales)
-- ════════════════════════════════════════════════════════════════
-- Estructura: {project_id}/{tipo_doc}/{filename}
--             general/Normativa/{filename}
INSERT INTO storage.buckets (id, name, public)
VALUES ('documentos', 'documentos', false)
ON CONFLICT (id) DO NOTHING;

-- ════════════════════════════════════════════════════════════════
-- 3. TABLA PRINCIPAL: PROYECTOS
-- ════════════════════════════════════════════════════════════════
-- Un proyecto = una empresa + el trabajo que haces para ella.
-- Fusiona lo que antes eran "clients" y "projects" separados.
CREATE TABLE IF NOT EXISTS projects (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  consultant_id     UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  -- Datos de la empresa
  nombre            TEXT NOT NULL,           -- nombre de la empresa
  cif               TEXT,                    -- NIF/CIF
  cnae              TEXT,                    -- código CNAE
  sector            TEXT,                    -- industrial, químico, alimentario...
  comunidad_autonoma TEXT,                   -- para normativa autonómica
  municipio         TEXT,
  direccion         TEXT,
  contacto_nombre   TEXT,
  contacto_email    TEXT,
  contacto_telefono TEXT,
  notas             TEXT,
  -- Datos del proyecto/trabajo
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
-- 4. TABLAS DE DOCUMENTOS
-- ════════════════════════════════════════════════════════════════

-- ── Documentos procesados ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS client_documents (
  id                    TEXT PRIMARY KEY,        -- doc_{sha256_16}
  project_id            UUID REFERENCES projects(id) ON DELETE CASCADE,
  titulo                TEXT NOT NULL,
  tipo                  TEXT NOT NULL,
  naturaleza_pdf        TEXT,                    -- digital/scanned/hybrid/encrypted/excel
  total_paginas         INT,
  total_chunks          INT,
  tablas_encontradas    INT DEFAULT 0,
  ocr_aplicado          BOOLEAN DEFAULT false,
  ocr_confianza_media   DECIMAL(4,3),
  fue_encriptado        BOOLEAN DEFAULT false,
  storage_path          TEXT,                    -- path en Supabase Storage
  advertencias          TEXT[] DEFAULT '{}',
  metadata              JSONB DEFAULT '{}',
  estado                TEXT DEFAULT 'indexado'
    CHECK (estado IN ('procesando','indexado','error','pendiente')),
  fecha_documento       DATE,
  fecha_vencimiento     DATE,
  fecha_ingesta         TIMESTAMPTZ DEFAULT now(),
  -- Google Drive sync
  drive_file_id         TEXT,

  CONSTRAINT valid_tipo CHECK (tipo IN (
    'autorizacion_ambiental_integrada','declaracion_anual_residuos',
    'contrato_gestor','factura','registro_produccion',
    'permiso_ambiental','manual_interno','normativa','desconocido',
    -- Tipos Excel
    'costes_anuales','inventario_ler','comparativa_gestores',
    'facturas_agregadas','presupuesto'
  ))
);

CREATE INDEX idx_docs_project ON client_documents(project_id);
CREATE INDEX idx_docs_tipo ON client_documents(tipo);
CREATE INDEX idx_docs_vencimiento ON client_documents(fecha_vencimiento)
  WHERE fecha_vencimiento IS NOT NULL;

-- ── Chunks con embeddings (corazón del RAG) ────────────────────
CREATE TABLE IF NOT EXISTS document_chunks (
  id            TEXT PRIMARY KEY,                -- {doc_id}_chunk_{index}
  document_id   TEXT REFERENCES client_documents(id) ON DELETE CASCADE,
  chunk_index   INT NOT NULL,
  contenido     TEXT NOT NULL,
  embedding     VECTOR(1536),                    -- OpenAI text-embedding-3-large
  chunk_type    TEXT,                            -- texto/tabla/seccion/clausula/linea_factura
  page_start    INT,
  page_end      INT,
  tokens        INT,
  metadata      JSONB DEFAULT '{}',
  -- Scoping RAG: 'general' (normativa) o 'project' (docs del proyecto)
  rag_scope     TEXT DEFAULT 'general'
    CHECK (rag_scope IN ('general', 'project')),
  project_id    UUID REFERENCES projects(id) ON DELETE CASCADE
);

-- Índice vectorial IVFFlat (cosine distance)
CREATE INDEX idx_chunks_embedding ON document_chunks
  USING ivfflat (embedding vector_cosine_ops)
  WITH (lists = 100);

CREATE INDEX idx_chunks_document ON document_chunks(document_id);
CREATE INDEX idx_chunks_type ON document_chunks(chunk_type);
CREATE INDEX idx_chunks_scope ON document_chunks(rag_scope);
CREATE INDEX idx_chunks_project ON document_chunks(project_id)
  WHERE project_id IS NOT NULL;

-- ════════════════════════════════════════════════════════════════
-- 5. TABLAS SECUNDARIAS (datos estructurados)
-- ════════════════════════════════════════════════════════════════

-- ── Inventario de residuos (LER + precios) ─────────────────────
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
  fuente_doc_id         TEXT REFERENCES client_documents(id),
  año                   INT,
  created_at            TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_waste_inv_project ON waste_inventory(project_id);
CREATE INDEX idx_waste_inv_ler ON waste_inventory(codigo_ler);

-- ── Líneas de facturas (tracking financiero) ───────────────────
CREATE TABLE IF NOT EXISTS invoice_lines (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id          UUID REFERENCES projects(id) ON DELETE CASCADE,
  doc_id              TEXT REFERENCES client_documents(id),
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

-- ── Alertas de cumplimiento ────────────────────────────────────
CREATE TABLE IF NOT EXISTS compliance_alerts (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id    UUID REFERENCES projects(id) ON DELETE CASCADE,
  tipo          TEXT NOT NULL,
  descripcion   TEXT NOT NULL,
  severidad     TEXT CHECK (severidad IN ('baja','media','alta','critica')),
  doc_id        TEXT REFERENCES client_documents(id),
  estado        TEXT DEFAULT 'pendiente'
    CHECK (estado IN ('pendiente','vista','resuelta','descartada')),
  fecha_limite  DATE,
  created_at    TIMESTAMPTZ DEFAULT now(),
  resolved_at   TIMESTAMPTZ
);

CREATE INDEX idx_alerts_project ON compliance_alerts(project_id);
CREATE INDEX idx_alerts_estado ON compliance_alerts(estado);
CREATE INDEX idx_alerts_severidad ON compliance_alerts(severidad);

-- ── Oportunidades de ahorro ────────────────────────────────────
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

-- ── Gestores de residuos autorizados ─────────────────────────
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

-- ── Contratos proyecto ↔ gestor ────────────────────────────────
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

-- ── Google Drive sync log ──────────────────────────────────────
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
-- 6. FUNCIONES RAG
-- ════════════════════════════════════════════════════════════════

-- ── Búsqueda con scoping (general vs proyecto) ─────────────────
CREATE OR REPLACE FUNCTION search_chunks_scoped(
  query_embedding     VECTOR(1536),
  rag_scope_filter    TEXT,
  project_id_filter   UUID    DEFAULT NULL,
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
  storage_path  TEXT,
  rag_scope     TEXT
)
LANGUAGE SQL STABLE AS $$
  SELECT
    dc.id                                    AS chunk_id,
    dc.document_id,
    dc.contenido,
    dc.chunk_type,
    1 - (dc.embedding <=> query_embedding)   AS similarity,
    cd.titulo                                AS doc_titulo,
    cd.tipo                                  AS doc_tipo,
    cd.metadata                              AS doc_metadata,
    cd.storage_path,
    dc.rag_scope
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

-- ── Búsqueda combinada (ambos scopes en una llamada) ───────────
CREATE OR REPLACE FUNCTION search_chunks_combined(
  query_embedding     VECTOR(1536),
  project_id_filter   UUID    DEFAULT NULL,
  doc_type_filter     TEXT    DEFAULT NULL,
  match_threshold     FLOAT   DEFAULT 0.70,
  match_count_general INT     DEFAULT 5,
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
  rag_scope     TEXT
)
LANGUAGE SQL STABLE AS $$
  (
    SELECT dc.id, dc.document_id, dc.contenido, dc.chunk_type,
           1 - (dc.embedding <=> query_embedding) AS similarity,
           cd.titulo, cd.tipo, cd.metadata, cd.storage_path, dc.rag_scope
    FROM document_chunks dc
    JOIN client_documents cd ON dc.document_id = cd.id
    WHERE dc.rag_scope = 'general'
      AND (doc_type_filter IS NULL OR cd.tipo = doc_type_filter)
      AND 1 - (dc.embedding <=> query_embedding) > match_threshold
    ORDER BY dc.embedding <=> query_embedding
    LIMIT match_count_general
  )
  UNION ALL
  (
    SELECT dc.id, dc.document_id, dc.contenido, dc.chunk_type,
           1 - (dc.embedding <=> query_embedding) AS similarity,
           cd.titulo, cd.tipo, cd.metadata, cd.storage_path, dc.rag_scope
    FROM document_chunks dc
    JOIN client_documents cd ON dc.document_id = cd.id
    WHERE dc.rag_scope = 'project'
      AND (project_id_filter IS NULL OR dc.project_id = project_id_filter)
      AND (doc_type_filter IS NULL OR cd.tipo = doc_type_filter)
      AND 1 - (dc.embedding <=> query_embedding) > match_threshold
    ORDER BY dc.embedding <=> query_embedding
    LIMIT match_count_project
  )
  ORDER BY similarity DESC;
$$;

-- ════════════════════════════════════════════════════════════════
-- 7. VISTAS
-- ════════════════════════════════════════════════════════════════

CREATE OR REPLACE VIEW rag_stats AS
SELECT
  dc.rag_scope,
  cd.tipo                               AS doc_type,
  cd.project_id,
  COUNT(DISTINCT cd.id)                 AS num_documents,
  COUNT(dc.id)                          AS num_chunks,
  AVG(dc.tokens)                        AS avg_tokens_per_chunk,
  MAX(cd.fecha_ingesta)                 AS last_ingestion
FROM document_chunks dc
JOIN client_documents cd ON dc.document_id = cd.id
WHERE dc.embedding IS NOT NULL
GROUP BY dc.rag_scope, cd.tipo, cd.project_id;

-- ════════════════════════════════════════════════════════════════
-- 8. ROW LEVEL SECURITY
-- ════════════════════════════════════════════════════════════════

ALTER TABLE projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE client_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE document_chunks ENABLE ROW LEVEL SECURITY;
ALTER TABLE waste_inventory ENABLE ROW LEVEL SECURITY;
ALTER TABLE invoice_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE compliance_alerts ENABLE ROW LEVEL SECURITY;
ALTER TABLE savings_opportunities ENABLE ROW LEVEL SECURITY;
ALTER TABLE contracts ENABLE ROW LEVEL SECURITY;

-- Cada consultor solo ve sus proyectos
CREATE POLICY "consultant_own_projects" ON projects
  FOR ALL USING (consultant_id = auth.uid());

-- Documentos: el consultor ve docs de sus proyectos + docs generales (sin project_id)
CREATE POLICY "user_own_documents" ON client_documents
  FOR ALL USING (
    project_id IS NULL
    OR project_id IN (
      SELECT id FROM projects WHERE consultant_id = auth.uid()
    )
  );

-- Chunks: RAG general accesible por todos, proyecto solo por el consultor
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
    -- General docs (no project) can be inserted by any authenticated user
    rag_scope = 'general'
    OR document_id IN (
      SELECT id FROM client_documents WHERE project_id IN (
        SELECT id FROM projects WHERE consultant_id = auth.uid()
      )
    )
  );

CREATE POLICY "user_own_waste_inventory" ON waste_inventory
  FOR ALL USING (
    project_id IN (
      SELECT id FROM projects WHERE consultant_id = auth.uid()
    )
  );

CREATE POLICY "user_own_invoice_lines" ON invoice_lines
  FOR ALL USING (
    project_id IN (
      SELECT id FROM projects WHERE consultant_id = auth.uid()
    )
  );

CREATE POLICY "user_own_alerts" ON compliance_alerts
  FOR ALL USING (
    project_id IN (
      SELECT id FROM projects WHERE consultant_id = auth.uid()
    )
  );

CREATE POLICY "user_own_savings" ON savings_opportunities
  FOR ALL USING (
    project_id IN (
      SELECT id FROM projects WHERE consultant_id = auth.uid()
    )
  );

CREATE POLICY "authenticated_read_managers" ON waste_managers
  FOR SELECT USING (auth.role() = 'authenticated');

CREATE POLICY "user_own_contracts" ON contracts
  FOR ALL USING (
    project_id IN (
      SELECT id FROM projects WHERE consultant_id = auth.uid()
    )
  );

-- ════════════════════════════════════════════════════════════════
-- 9. STORAGE POLICIES (bucket "documentos")
-- ════════════════════════════════════════════════════════════════

CREATE POLICY "consultant_upload_documents" ON storage.objects
  FOR INSERT WITH CHECK (
    bucket_id = 'documentos'
    AND (
      (storage.foldername(name))[1] = 'general'
      OR
      (storage.foldername(name))[1] IN (
        SELECT id::text FROM projects WHERE consultant_id = auth.uid()
      )
    )
  );

CREATE POLICY "consultant_read_documents" ON storage.objects
  FOR SELECT USING (
    bucket_id = 'documentos'
    AND (
      (storage.foldername(name))[1] = 'general'
      OR
      (storage.foldername(name))[1] IN (
        SELECT id::text FROM projects WHERE consultant_id = auth.uid()
      )
    )
  );

CREATE POLICY "consultant_delete_documents" ON storage.objects
  FOR DELETE USING (
    bucket_id = 'documentos'
    AND (
      (storage.foldername(name))[1] = 'general'
      OR
      (storage.foldername(name))[1] IN (
        SELECT id::text FROM projects WHERE consultant_id = auth.uid()
      )
    )
  );

-- ════════════════════════════════════════════════════════════════
-- 10. REALTIME
-- ════════════════════════════════════════════════════════════════

ALTER PUBLICATION supabase_realtime ADD TABLE pipeline_progress;
ALTER PUBLICATION supabase_realtime ADD TABLE compliance_alerts;
ALTER PUBLICATION supabase_realtime ADD TABLE projects;
