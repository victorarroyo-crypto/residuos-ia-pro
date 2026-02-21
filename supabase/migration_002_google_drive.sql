-- ═══════════════════════════════════════════════════════════════
-- MIGRATION 002: Google Drive Integration
-- ═══════════════════════════════════════════════════════════════
-- Run this in Supabase SQL Editor after migration_001.
-- All operations are idempotent (safe to re-run).

-- 1. Store Google Drive OAuth tokens per consultant
CREATE TABLE IF NOT EXISTS consultant_gdrive (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  consultant_id       UUID NOT NULL UNIQUE,
  access_token        TEXT,
  refresh_token       TEXT NOT NULL,
  token_expiry        TIMESTAMPTZ,
  root_folder_id      TEXT,             -- GD ID of "RAG_Residuos_Industriales"
  folder_mapping      JSONB DEFAULT '{}', -- All folder IDs: {section_name: folder_id, ...}
  created_at          TIMESTAMPTZ DEFAULT now(),
  updated_at          TIMESTAMPTZ DEFAULT now()
);

-- RLS: consultant can only see their own tokens
ALTER TABLE consultant_gdrive ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY user_own_gdrive ON consultant_gdrive
    FOR ALL USING (consultant_id = auth.uid());
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- 2. Add Drive file ID to client_documents (link to GD copy)
ALTER TABLE client_documents ADD COLUMN IF NOT EXISTS drive_file_id TEXT;
