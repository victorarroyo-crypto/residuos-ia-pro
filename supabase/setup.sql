-- ================================================================
-- SETUP COMPLETO SUPABASE - ResidusIA Pro
-- ================================================================
-- Ejecutar en Supabase SQL Editor en una sola ejecución.
-- Este archivo consolida schema.sql + schema_scoping.sql con
-- todas las tablas en el orden correcto de dependencias.
--
-- Orden: extensiones → bucket → clients → projects →
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
-- Estructura: {client_id}/{tipo_doc}/{filename}
--             general/Normativa/{filename}
INSERT INTO storage.buckets (id, name, public)
VALUES ('documentos', 'documentos', false)
ON CONFLICT (id) DO NOTHING;

-- ════════════════════════════════════════════════════════════════
-- 3. TABLAS BASE
-- ════════════════════════════════════════════════════════════════

-- ── Consultores/clientes ───────────────────────────────────────
CREATE TABLE IF NOT EXISTS clients (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  consultant_id   UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  nombre          TEXT NOT NULL,
  cif             TEXT,                -- NIF/CIF de la empresa
  sector          TEXT,                -- industrial, químico, alimentario, etc.
  comunidad_autonoma TEXT,             -- para aplicar normativa autonómica
  direccion       TEXT,
  contacto_nombre TEXT,
  contacto_email  TEXT,
  contacto_telefono TEXT,
  notas           TEXT,
  created_at      TIMESTAMPTZ DEFAULT now(),
  updated_at      TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_clients_consultant ON clients(consultant_id);

-- ── Proyectos (cada cliente puede tener varios) ────────────────
CREATE TABLE IF NOT EXISTS projects (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id       UUID REFERENCES clients(id) ON DELETE CASCADE,
  consultant_id   UUID REFERENCES auth.users(id),
  nombre          TEXT NOT NULL,
  descripcion     TEXT,
  tipo            TEXT CHECK (tipo IN (
    'diagnostico_inicial', 'retainer_anual', 'auditoria', 'optimizacion_puntual'
  )),
  estado          TEXT DEFAULT 'activo'
    CHECK (estado IN ('activo','completado','pausado')),
  fecha_inicio    DATE DEFAULT CURRENT_DATE,
  fecha_fin       DATE,
  created_at      TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_projects_client ON projects(client_id);
CREATE INDEX idx_projects_consultant ON projects(consultant_id);

-- ════════════════════════════════════════════════════════════════
-- 4. TABLAS DE DOCUMENTOS
-- ════════════════════════════════════════════════════════════════

-- ── Documentos procesados ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS client_documents (
  id                    TEXT PRIMARY KEY,        -- doc_{sha256_16}
  client_id             UUID REFERENCES clients(id) ON DELETE CASCADE,
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

  CONSTRAINT valid_tipo CHECK (tipo IN (
    'autorizacion_ambiental_integrada','declaracion_anual_residuos',
    'contrato_gestor','factura','registro_produccion',
    'permiso_ambiental','manual_interno','normativa','desconocido',
    -- Tipos Excel
    'costes_anuales','inventario_ler','comparativa_gestores',
    'facturas_agregadas','presupuesto'
  ))
);

CREATE INDEX idx_client_docs_client ON client_documents(client_id);
CREATE INDEX idx_client_docs_tipo ON client_documents(tipo);
CREATE INDEX idx_client_docs_vencimiento ON client_documents(fecha_vencimiento)
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
  -- Columnas de scoping RAG
  rag_scope     TEXT DEFAULT 'project'
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
  client_id             UUID REFERENCES clients(id) ON DELETE CASCADE,
  codigo_ler            TEXT,
  descripcion           TEXT,
  cantidad_anual_ton    DECIMAL(10,3),
  precio_actual_eur_ton DECIMAL(10,2),
  operacion             TEXT,                    -- D/R + código (ej: R13, D15)
  fuente_doc_id         TEXT REFERENCES client_documents(id),
  año                   INT,
  created_at            TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_waste_inv_client ON waste_inventory(client_id);
CREATE INDEX idx_waste_inv_ler ON waste_inventory(codigo_ler);

-- ── Líneas de facturas (tracking financiero) ───────────────────
CREATE TABLE IF NOT EXISTS invoice_lines (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id           UUID REFERENCES clients(id) ON DELETE CASCADE,
  doc_id              TEXT REFERENCES client_documents(id),
  fecha               DATE,
  codigo_ler          TEXT,
  descripcion         TEXT,
  cantidad_toneladas  DECIMAL(10,3),
  precio_unitario     DECIMAL(10,2),
  importe_eur         DECIMAL(10,2),
  created_at          TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_invoice_lines_client ON invoice_lines(client_id);
CREATE INDEX idx_invoice_lines_ler ON invoice_lines(codigo_ler);
CREATE INDEX idx_invoice_lines_fecha ON invoice_lines(fecha);

-- ── Alertas de cumplimiento ────────────────────────────────────
CREATE TABLE IF NOT EXISTS compliance_alerts (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id     UUID REFERENCES clients(id) ON DELETE CASCADE,
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

CREATE INDEX idx_alerts_client ON compliance_alerts(client_id);
CREATE INDEX idx_alerts_estado ON compliance_alerts(estado);
CREATE INDEX idx_alerts_severidad ON compliance_alerts(severidad);

-- ── Progreso del pipeline (UI en tiempo real) ──────────────────
CREATE TABLE IF NOT EXISTS pipeline_progress (
  doc_id      TEXT PRIMARY KEY,
  step        TEXT NOT NULL,
  percentage  INT CHECK (percentage BETWEEN 0 AND 100),
  mensaje     TEXT,
  error       TEXT,
  updated_at  TIMESTAMPTZ DEFAULT now()
);

-- ════════════════════════════════════════════════════════════════
-- 6. FUNCIONES RAG
-- ════════════════════════════════════════════════════════════════

-- ── Búsqueda básica (sin scoping) ──────────────────────────────
CREATE OR REPLACE FUNCTION search_chunks(
  query_embedding  VECTOR(1536),
  client_id_filter UUID DEFAULT NULL,
  doc_type_filter  TEXT DEFAULT NULL,
  match_threshold  FLOAT DEFAULT 0.7,
  match_count      INT DEFAULT 8
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
    dc.id          AS chunk_id,
    dc.document_id,
    dc.contenido,
    dc.chunk_type,
    1 - (dc.embedding <=> query_embedding) AS similarity,
    cd.titulo      AS doc_titulo,
    cd.tipo        AS doc_tipo,
    cd.metadata    AS doc_metadata,
    cd.storage_path
  FROM document_chunks dc
  JOIN client_documents cd ON dc.document_id = cd.id
  WHERE
    1 - (dc.embedding <=> query_embedding) > match_threshold
    AND (client_id_filter IS NULL OR cd.client_id = client_id_filter)
    AND (doc_type_filter IS NULL OR cd.tipo = doc_type_filter)
  ORDER BY dc.embedding <=> query_embedding
  LIMIT match_count;
$$;

-- ── Búsqueda con scoping (general vs proyecto) ─────────────────
CREATE OR REPLACE FUNCTION search_chunks_scoped(
  query_embedding     VECTOR(1536),
  rag_scope_filter    TEXT,
  client_id_filter    UUID    DEFAULT NULL,
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
      OR (
        (client_id_filter IS NULL  OR cd.client_id = client_id_filter)
        AND (project_id_filter IS NULL OR dc.project_id = project_id_filter)
      )
    )
    AND (doc_type_filter IS NULL OR cd.tipo = doc_type_filter)
    AND 1 - (dc.embedding <=> query_embedding) > match_threshold
  ORDER BY dc.embedding <=> query_embedding
  LIMIT match_count;
$$;

-- ── Búsqueda combinada (ambos scopes en una llamada) ───────────
CREATE OR REPLACE FUNCTION search_chunks_combined(
  query_embedding     VECTOR(1536),
  client_id_filter    UUID    DEFAULT NULL,
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
      AND (client_id_filter IS NULL OR cd.client_id = client_id_filter)
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
  cd.client_id,
  COUNT(DISTINCT cd.id)                 AS num_documents,
  COUNT(dc.id)                          AS num_chunks,
  AVG(dc.tokens)                        AS avg_tokens_per_chunk,
  MAX(cd.fecha_ingesta)                 AS last_ingestion
FROM document_chunks dc
JOIN client_documents cd ON dc.document_id = cd.id
WHERE dc.embedding IS NOT NULL
GROUP BY dc.rag_scope, cd.tipo, cd.client_id;

-- ════════════════════════════════════════════════════════════════
-- 8. ROW LEVEL SECURITY
-- ════════════════════════════════════════════════════════════════

ALTER TABLE clients ENABLE ROW LEVEL SECURITY;
ALTER TABLE projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE client_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE document_chunks ENABLE ROW LEVEL SECURITY;
ALTER TABLE waste_inventory ENABLE ROW LEVEL SECURITY;
ALTER TABLE invoice_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE compliance_alerts ENABLE ROW LEVEL SECURITY;

-- Cada consultor solo ve sus clientes
CREATE POLICY "consultant_own_clients" ON clients
  FOR ALL USING (consultant_id = auth.uid());

CREATE POLICY "consultant_own_projects" ON projects
  FOR ALL USING (consultant_id = auth.uid());

CREATE POLICY "user_own_documents" ON client_documents
  FOR ALL USING (
    client_id IN (
      SELECT id FROM clients WHERE consultant_id = auth.uid()
    )
  );

-- Chunks: RAG general accesible por todos, proyecto solo por el consultor
CREATE POLICY "read_scoped_chunks" ON document_chunks
  FOR SELECT USING (
    rag_scope = 'general'
    OR document_id IN (
      SELECT id FROM client_documents WHERE client_id IN (
        SELECT id FROM clients WHERE consultant_id = auth.uid()
      )
    )
  );

CREATE POLICY "insert_own_chunks" ON document_chunks
  FOR INSERT WITH CHECK (
    document_id IN (
      SELECT id FROM client_documents WHERE client_id IN (
        SELECT id FROM clients WHERE consultant_id = auth.uid()
      )
    )
  );

CREATE POLICY "user_own_waste_inventory" ON waste_inventory
  FOR ALL USING (
    client_id IN (
      SELECT id FROM clients WHERE consultant_id = auth.uid()
    )
  );

CREATE POLICY "user_own_invoice_lines" ON invoice_lines
  FOR ALL USING (
    client_id IN (
      SELECT id FROM clients WHERE consultant_id = auth.uid()
    )
  );

CREATE POLICY "user_own_alerts" ON compliance_alerts
  FOR ALL USING (
    client_id IN (
      SELECT id FROM clients WHERE consultant_id = auth.uid()
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
        SELECT id::text FROM clients WHERE consultant_id = auth.uid()
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
        SELECT id::text FROM clients WHERE consultant_id = auth.uid()
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
        SELECT id::text FROM clients WHERE consultant_id = auth.uid()
      )
    )
  );

-- ════════════════════════════════════════════════════════════════
-- 10. REALTIME
-- ════════════════════════════════════════════════════════════════

ALTER PUBLICATION supabase_realtime ADD TABLE pipeline_progress;
ALTER PUBLICATION supabase_realtime ADD TABLE compliance_alerts;
ALTER PUBLICATION supabase_realtime ADD TABLE projects;
