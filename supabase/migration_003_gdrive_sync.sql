-- ═══════════════════════════════════════════════════════════════
-- MIGRATION 003: Google Drive Auto-Sync
-- ═══════════════════════════════════════════════════════════════
-- Run this in Supabase SQL Editor after migration_002.
-- All operations are idempotent (safe to re-run).

-- 1. Sync log: tracks each sync run
CREATE TABLE IF NOT EXISTS gdrive_sync_log (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  consultant_id       UUID NOT NULL,
  status              TEXT NOT NULL DEFAULT 'running',  -- running | completed | error
  started_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at        TIMESTAMPTZ,
  total_files_found   INT DEFAULT 0,
  files_ingested      INT DEFAULT 0,
  files_skipped       INT DEFAULT 0,
  files_failed        INT DEFAULT 0,
  error_message       TEXT,
  details             JSONB DEFAULT '[]'::JSONB  -- per-file results
);

CREATE INDEX IF NOT EXISTS idx_sync_log_consultant
  ON gdrive_sync_log (consultant_id, started_at DESC);

-- 2. Add last_synced_at to consultant_gdrive
ALTER TABLE consultant_gdrive
  ADD COLUMN IF NOT EXISTS last_synced_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS auto_sync_enabled BOOLEAN DEFAULT true;

-- 3. RLS for sync log
ALTER TABLE gdrive_sync_log ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY user_own_sync_log ON gdrive_sync_log
    FOR ALL USING (consultant_id = auth.uid());
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
