-- Migration 006: analysis_progress table for Supabase Realtime
-- Replaces the SSE-based in-memory progress tracking for multi-agent analysis.
-- The Python pipeline INSERTs rows here; the frontend subscribes via Supabase Realtime.
--
-- IMPORTANT: Execute this in Supabase SQL Editor before deploying the new code.

CREATE TABLE IF NOT EXISTS analysis_progress (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  event_type text NOT NULL,    -- load_start, load_done, agent_start, agent_done, complete
  agent text,                  -- aai, contratos, facturas, registro, normativo, optimizador, redactor
  findings_count integer,
  created_at timestamptz DEFAULT now()
);

-- Enable Realtime so the frontend receives INSERT events instantly
ALTER PUBLICATION supabase_realtime ADD TABLE analysis_progress;

-- RLS: each consultant only sees progress for their own projects
ALTER TABLE analysis_progress ENABLE ROW LEVEL SECURITY;

CREATE POLICY "user_own_analysis_progress" ON analysis_progress
  FOR ALL USING (project_id IN (SELECT id FROM projects WHERE consultant_id = auth.uid()));

-- Service role (Python pipeline) can write freely
CREATE POLICY "service_write_analysis_progress" ON analysis_progress
  FOR ALL USING (auth.role() = 'service_role');

-- Fast lookup by project
CREATE INDEX idx_analysis_progress_project ON analysis_progress(project_id);
