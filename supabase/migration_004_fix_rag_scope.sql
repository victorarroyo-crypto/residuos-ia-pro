-- ============================================================
-- Migration 004: Fix RAG scope — backfill rag_scope column
-- ============================================================
-- Problem: rag_scope and project_id were stored only in metadata
-- JSONB but never written to the actual indexed columns.
-- All chunks have rag_scope = 'project' (column DEFAULT) when
-- normativa/BREF/directive docs should be 'general'.
-- ============================================================

-- 1. Backfill rag_scope from metadata for chunks that have it
UPDATE document_chunks
SET rag_scope = metadata->>'rag_scope'
WHERE metadata->>'rag_scope' IS NOT NULL
  AND metadata->>'rag_scope' IN ('general', 'project');

-- 2. For chunks whose parent document is normativa → force 'general'
UPDATE document_chunks dc
SET rag_scope = 'general'
FROM client_documents cd
WHERE dc.document_id = cd.id
  AND cd.tipo = 'normativa';

-- 3. For chunks whose parent document has no client_id → 'general'
UPDATE document_chunks dc
SET rag_scope = 'general'
FROM client_documents cd
WHERE dc.document_id = cd.id
  AND cd.client_id IS NULL;

-- 4. Backfill project_id from metadata where available
UPDATE document_chunks
SET project_id = (metadata->>'project_id')::UUID
WHERE metadata->>'project_id' IS NOT NULL
  AND project_id IS NULL;

-- 5. Verify the fix
-- SELECT rag_scope, COUNT(*) FROM document_chunks GROUP BY rag_scope;
