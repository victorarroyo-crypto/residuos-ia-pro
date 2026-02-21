-- ================================================================
-- SCHEMA SUPABASE - Pipeline PDF ResidusIA Pro
-- Ejecutar en Supabase SQL Editor
-- ================================================================

-- Extensión vectorial (ya incluida en Supabase)
CREATE EXTENSION IF NOT EXISTS vector;

-- ────────────────────────────────────────────────
-- BUCKET: Almacenamiento de documentos originales
-- Ejecutar desde Supabase Dashboard > Storage o via API
-- ────────────────────────────────────────────────
-- Estructura de paths dentro del bucket "documentos":
--   {client_id}/{tipo_doc}/{filename}
--   general/normativa/{filename}
--
-- Ejemplo:
--   a1b2c3d4/AAI_Autorizaciones/aai_empresa_2024.pdf
--   a1b2c3d4/Facturas/factura_gestor_enero.pdf
--   general/Normativa/ley_residuos_2022.pdf
--
INSERT INTO storage.buckets (id, name, public)
VALUES ('documentos', 'documentos', false)
ON CONFLICT (id) DO NOTHING;

-- ────────────────────────────────────────────────
-- TABLA: Documentos procesados
-- ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS client_documents (
  id                    TEXT PRIMARY KEY,  -- doc_{hash}
  client_id             UUID REFERENCES clients(id) ON DELETE CASCADE,
  titulo                TEXT NOT NULL,
  tipo                  TEXT NOT NULL,     -- DocType enum
  naturaleza_pdf        TEXT,             -- digital/scanned/hybrid/encrypted
  total_paginas         INT,
  total_chunks          INT,
  tablas_encontradas    INT DEFAULT 0,
  ocr_aplicado          BOOLEAN DEFAULT false,
  ocr_confianza_media   DECIMAL(4,3),     -- 0.0 a 1.0
  fue_encriptado        BOOLEAN DEFAULT false,
  storage_path          TEXT,              -- path en Supabase Storage: {client_id}/{tipo}/{filename}
  advertencias          TEXT[] DEFAULT '{}',
  metadata              JSONB DEFAULT '{}',
  estado                TEXT DEFAULT 'indexado'
    CHECK (estado IN ('procesando','indexado','error','pendiente')),
  fecha_documento       DATE,
  fecha_vencimiento     DATE,
  fecha_ingesta         TIMESTAMPTZ DEFAULT now(),

  -- Índices para búsquedas frecuentes
  CONSTRAINT valid_tipo CHECK (tipo IN (
    'autorizacion_ambiental_integrada','declaracion_anual_residuos',
    'contrato_gestor','factura','registro_produccion',
    'permiso_ambiental','manual_interno','normativa','desconocido'
  ))
);

CREATE INDEX idx_client_docs_client ON client_documents(client_id);
CREATE INDEX idx_client_docs_tipo ON client_documents(tipo);
CREATE INDEX idx_client_docs_vencimiento ON client_documents(fecha_vencimiento)
  WHERE fecha_vencimiento IS NOT NULL;

-- ────────────────────────────────────────────────
-- TABLA: Chunks con embeddings (el corazón del RAG)
-- ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS document_chunks (
  id            TEXT PRIMARY KEY,   -- {doc_id}_chunk_{index}
  document_id   TEXT REFERENCES client_documents(id) ON DELETE CASCADE,
  chunk_index   INT NOT NULL,
  contenido     TEXT NOT NULL,
  embedding     VECTOR(1536),       -- OpenAI text-embedding-3-large
  chunk_type    TEXT,               -- texto/tabla/seccion/clausula/linea_factura
  page_start    INT,
  page_end      INT,
  tokens        INT,
  metadata      JSONB DEFAULT '{}'
);

-- Índice vectorial IVFFlat (eficiente para búsqueda semántica)
CREATE INDEX idx_chunks_embedding ON document_chunks
  USING ivfflat (embedding vector_cosine_ops)
  WITH (lists = 100);

CREATE INDEX idx_chunks_document ON document_chunks(document_id);
CREATE INDEX idx_chunks_type ON document_chunks(chunk_type);

-- ────────────────────────────────────────────────
-- TABLA: Líneas de facturas (para tracking financiero)
-- ────────────────────────────────────────────────
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

-- ────────────────────────────────────────────────
-- TABLA: Alertas de cumplimiento (generadas automáticamente)
-- ────────────────────────────────────────────────
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

-- ────────────────────────────────────────────────
-- TABLA: Progreso del pipeline (para UI en tiempo real)
-- ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS pipeline_progress (
  doc_id      TEXT PRIMARY KEY,
  step        TEXT NOT NULL,
  percentage  INT CHECK (percentage BETWEEN 0 AND 100),
  mensaje     TEXT,
  error       TEXT,
  updated_at  TIMESTAMPTZ DEFAULT now()
);

-- ────────────────────────────────────────────────
-- FUNCIÓN RAG: Búsqueda semántica con filtros
-- ────────────────────────────────────────────────
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

-- ────────────────────────────────────────────────
-- REALTIME: Habilitar para pipeline_progress
-- (permite que la UI muestre progreso en tiempo real)
-- ────────────────────────────────────────────────
ALTER PUBLICATION supabase_realtime ADD TABLE pipeline_progress;
ALTER PUBLICATION supabase_realtime ADD TABLE compliance_alerts;

-- ────────────────────────────────────────────────
-- RLS (Row Level Security) - cada consultor solo ve sus clientes
-- ────────────────────────────────────────────────
ALTER TABLE client_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE document_chunks ENABLE ROW LEVEL SECURITY;
ALTER TABLE invoice_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE compliance_alerts ENABLE ROW LEVEL SECURITY;

-- Política: el usuario solo accede a documentos de sus clientes
CREATE POLICY "user_own_documents" ON client_documents
  FOR ALL USING (
    client_id IN (
      SELECT id FROM clients WHERE consultant_id = auth.uid()
    )
  );

CREATE POLICY "user_own_chunks" ON document_chunks
  FOR ALL USING (
    document_id IN (
      SELECT id FROM client_documents WHERE client_id IN (
        SELECT id FROM clients WHERE consultant_id = auth.uid()
      )
    )
  );

-- ────────────────────────────────────────────────
-- RLS para Supabase Storage (bucket "documentos")
-- Solo el consultor del cliente puede acceder a sus archivos
-- ────────────────────────────────────────────────
CREATE POLICY "consultant_upload_documents" ON storage.objects
  FOR INSERT WITH CHECK (
    bucket_id = 'documentos'
    AND (
      -- Documentos generales (normativa) accesibles por cualquier usuario autenticado
      (storage.foldername(name))[1] = 'general'
      OR
      -- Documentos de cliente: solo si el consultor gestiona ese cliente
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
