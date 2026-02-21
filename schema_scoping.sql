-- ================================================================
-- SCHEMA ADICIONAL - RAG Scoping + Excel Support
-- Añadir al schema.sql existente
-- ================================================================

-- ────────────────────────────────────────────────
-- AÑADIR columnas de scoping a document_chunks
-- ────────────────────────────────────────────────
ALTER TABLE document_chunks 
  ADD COLUMN IF NOT EXISTS rag_scope  TEXT DEFAULT 'project'
    CHECK (rag_scope IN ('general', 'project')),
  ADD COLUMN IF NOT EXISTS project_id UUID REFERENCES projects(id) ON DELETE CASCADE;

-- Índices para filtrado por scope (crítico para performance del RAG)
CREATE INDEX IF NOT EXISTS idx_chunks_scope 
  ON document_chunks(rag_scope);

CREATE INDEX IF NOT EXISTS idx_chunks_project 
  ON document_chunks(project_id) 
  WHERE project_id IS NOT NULL;

-- ────────────────────────────────────────────────
-- TABLA: Proyectos (cada cliente puede tener varios)
-- ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS projects (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id       UUID REFERENCES clients(id) ON DELETE CASCADE,
  consultant_id   UUID REFERENCES auth.users(id),
  nombre          TEXT NOT NULL,
  descripcion     TEXT,
  tipo            TEXT CHECK (tipo IN (
    'diagnostico_inicial', 'retainer_anual', 'auditoria', 'optimizacion_puntual'
  )),
  estado          TEXT DEFAULT 'activo' CHECK (estado IN ('activo','completado','pausado')),
  fecha_inicio    DATE DEFAULT CURRENT_DATE,
  fecha_fin       DATE,
  created_at      TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_projects_client ON projects(client_id);
CREATE INDEX idx_projects_consultant ON projects(consultant_id);

-- ────────────────────────────────────────────────
-- FUNCIÓN RAG: Búsqueda con scoping separado
-- Reemplaza a search_chunks del schema.sql anterior
-- ────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION search_chunks_scoped(
  query_embedding     VECTOR(1536),
  rag_scope_filter    TEXT,                  -- 'general' o 'project'
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
    -- Filtro de scope (siempre aplica)
    dc.rag_scope = rag_scope_filter

    -- Para scope general: no filtrar por cliente
    AND (
      rag_scope_filter = 'general'
      OR (
        -- Para scope de proyecto: filtrar por cliente o proyecto
        (client_id_filter IS NULL  OR cd.client_id = client_id_filter)
        AND (project_id_filter IS NULL OR dc.project_id = project_id_filter)
      )
    )

    -- Filtro opcional por tipo de documento
    AND (doc_type_filter IS NULL OR cd.tipo = doc_type_filter)

    -- Umbral de similitud
    AND 1 - (dc.embedding <=> query_embedding) > match_threshold

  ORDER BY dc.embedding <=> query_embedding
  LIMIT match_count;
$$;


-- ────────────────────────────────────────────────
-- FUNCIÓN: Buscar en ambos scopes en una sola llamada
-- Útil para el asistente IA cuando necesita contexto completo
-- ────────────────────────────────────────────────
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
  -- RAG general (normativa, benchmarks)
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
  -- RAG de proyecto (documentos del cliente)
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


-- ────────────────────────────────────────────────
-- VISTA: Estadísticas del RAG (para el dashboard)
-- ────────────────────────────────────────────────
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


-- ────────────────────────────────────────────────
-- RLS para projects
-- ────────────────────────────────────────────────
ALTER TABLE projects ENABLE ROW LEVEL SECURITY;

CREATE POLICY "consultant_own_projects" ON projects
  FOR ALL USING (consultant_id = auth.uid());

-- Los chunks de RAG general son accesibles por todos los usuarios autenticados
CREATE POLICY "read_general_rag" ON document_chunks
  FOR SELECT USING (
    rag_scope = 'general'
    OR document_id IN (
      SELECT id FROM client_documents WHERE client_id IN (
        SELECT id FROM clients WHERE consultant_id = auth.uid()
      )
    )
  );

-- ────────────────────────────────────────────────
-- REALTIME para projects
-- ────────────────────────────────────────────────
ALTER PUBLICATION supabase_realtime ADD TABLE projects;
