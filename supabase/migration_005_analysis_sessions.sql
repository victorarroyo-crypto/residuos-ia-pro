-- Migration 005: analysis_sessions table for HITL workflow persistence
-- Stores the state between HITL phases (plan → review → execute → results → round2)
--
-- IMPORTANT: Execute this in Supabase SQL Editor before using the HITL flow.
-- The HITL flow will work without this table (state stays in frontend memory),
-- but sessions won't survive page reloads.

CREATE TABLE IF NOT EXISTS analysis_sessions (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    consultant_id uuid NOT NULL,

    -- Workflow state
    phase text NOT NULL DEFAULT 'planning',  -- planning | plan_review | executing | results | round2 | complete

    -- Plan phase
    proposed_plan jsonb DEFAULT '{}',
    approved_plan jsonb DEFAULT '{}',

    -- Instructions from consultant
    consultant_instructions text DEFAULT '',
    agent_focus jsonb DEFAULT '{}',

    -- Results
    round1_results jsonb DEFAULT '{}',
    round2_results jsonb DEFAULT '{}',

    -- Advisor chat history (for context continuity)
    advisor_history jsonb DEFAULT '[]',

    -- Timestamps
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

-- RLS: each consultant only sees their own sessions
ALTER TABLE analysis_sessions ENABLE ROW LEVEL SECURITY;

CREATE POLICY consultant_own_sessions ON analysis_sessions
    FOR ALL
    USING (consultant_id = auth.uid());

-- Auto-update updated_at
CREATE OR REPLACE FUNCTION update_analysis_sessions_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER analysis_sessions_updated_at
    BEFORE UPDATE ON analysis_sessions
    FOR EACH ROW
    EXECUTE FUNCTION update_analysis_sessions_updated_at();

-- Index for fast lookup by project
CREATE INDEX idx_analysis_sessions_project ON analysis_sessions(project_id);
CREATE INDEX idx_analysis_sessions_consultant ON analysis_sessions(consultant_id);

-- TTL: clean up sessions older than 30 days (run periodically)
-- DELETE FROM analysis_sessions WHERE created_at < now() - interval '30 days';
