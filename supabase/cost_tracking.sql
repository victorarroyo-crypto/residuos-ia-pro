-- ================================================================
-- COST TRACKING - ResidusIA Pro
-- ================================================================
-- Tablas para monitoreo de costes IA, configuracion de modelos
-- y circuit breaker (cost guard).
--
-- Ejecutar en Supabase SQL Editor DESPUES de setup.sql
-- ================================================================

-- ════════════════════════════════════════════════════════════════
-- 1. LOG DE USO DE API (cada llamada a LLM/embeddings)
-- ════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS api_usage_log (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at      TIMESTAMPTZ DEFAULT now(),
  consultant_id   UUID,
  service         TEXT NOT NULL,      -- 'advisor', 'analysis', 'rag_query', 'pipeline', 'embedding'
  operation       TEXT NOT NULL,      -- 'advisor_chat', 'advisor_stream', 'agent_aai', 'embed_query', etc.
  provider        TEXT NOT NULL,      -- 'anthropic', 'openai', 'google'
  model           TEXT NOT NULL,      -- 'claude-sonnet-4', 'gpt-5.2', 'text-embedding-3-large', etc.
  input_tokens    INTEGER DEFAULT 0,
  output_tokens   INTEGER DEFAULT 0,
  total_tokens    INTEGER DEFAULT 0,
  cost_usd        NUMERIC(10,6) DEFAULT 0,
  duration_ms     INTEGER DEFAULT 0,
  project_id      UUID,
  success         BOOLEAN DEFAULT true,
  metadata        JSONB DEFAULT '{}'  -- thinking_tokens, web_searches, tier, agent_name, etc.
);

-- Indices para consultas frecuentes
CREATE INDEX IF NOT EXISTS idx_usage_consultant_date
  ON api_usage_log (consultant_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_usage_provider_date
  ON api_usage_log (provider, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_usage_service_date
  ON api_usage_log (service, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_usage_created_at
  ON api_usage_log (created_at DESC);

-- ════════════════════════════════════════════════════════════════
-- 2. CONFIGURACION DE MODELOS POR CONSULTOR Y SERVICIO
-- ════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS consultant_model_config (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  consultant_id   UUID NOT NULL,
  service         TEXT NOT NULL,       -- 'advisor', 'analysis', 'rag_query', 'pipeline'
  preferred_model TEXT NOT NULL,       -- 'claude-sonnet-4', 'gpt-5.2', etc.
  fallback_chain  TEXT[] DEFAULT '{}', -- ['gemini-2.5-pro', 'claude-haiku-4-5']
  tier            TEXT DEFAULT 'standard',  -- 'standard' o 'pro_plus'
  created_at      TIMESTAMPTZ DEFAULT now(),
  updated_at      TIMESTAMPTZ DEFAULT now(),
  UNIQUE(consultant_id, service)
);

-- ════════════════════════════════════════════════════════════════
-- 3. LIMITES DE COSTE POR CONSULTOR (circuit breaker)
-- ════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS consultant_cost_limits (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  consultant_id          UUID NOT NULL UNIQUE,
  anthropic_daily_limit  NUMERIC(10,2) DEFAULT 10.00,
  anthropic_monthly_limit NUMERIC(10,2) DEFAULT 100.00,
  openai_daily_limit     NUMERIC(10,2) DEFAULT 5.00,
  openai_monthly_limit   NUMERIC(10,2) DEFAULT 50.00,
  google_daily_limit     NUMERIC(10,2) DEFAULT 3.00,
  google_monthly_limit   NUMERIC(10,2) DEFAULT 30.00,
  global_daily_limit     NUMERIC(10,2) DEFAULT 18.00,
  global_monthly_limit   NUMERIC(10,2) DEFAULT 180.00,
  alert_threshold_pct    INTEGER DEFAULT 80,
  auto_fallback          BOOLEAN DEFAULT true,
  block_on_global_limit  BOOLEAN DEFAULT false,
  created_at             TIMESTAMPTZ DEFAULT now(),
  updated_at             TIMESTAMPTZ DEFAULT now()
);

-- ════════════════════════════════════════════════════════════════
-- 4. RLS POLICIES
-- ════════════════════════════════════════════════════════════════

-- api_usage_log: cada consultor ve solo sus datos
ALTER TABLE api_usage_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY user_own_usage ON api_usage_log
  FOR ALL USING (consultant_id = auth.uid());

CREATE POLICY service_write_usage ON api_usage_log
  FOR ALL USING (auth.role() = 'service_role');

-- consultant_model_config: cada consultor gestiona su config
ALTER TABLE consultant_model_config ENABLE ROW LEVEL SECURITY;

CREATE POLICY user_own_model_config ON consultant_model_config
  FOR ALL USING (consultant_id = auth.uid());

CREATE POLICY service_write_model_config ON consultant_model_config
  FOR ALL USING (auth.role() = 'service_role');

-- consultant_cost_limits: cada consultor gestiona sus limites
ALTER TABLE consultant_cost_limits ENABLE ROW LEVEL SECURITY;

CREATE POLICY user_own_cost_limits ON consultant_cost_limits
  FOR ALL USING (consultant_id = auth.uid());

CREATE POLICY service_write_cost_limits ON consultant_cost_limits
  FOR ALL USING (auth.role() = 'service_role');

-- ════════════════════════════════════════════════════════════════
-- 5. FUNCION: gasto acumulado por proveedor (dia/mes)
-- ════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION get_provider_spending(
  p_consultant_id UUID,
  p_provider TEXT
)
RETURNS TABLE (
  daily_total NUMERIC,
  monthly_total NUMERIC
)
LANGUAGE sql
STABLE
SECURITY DEFINER
AS $$
  SELECT
    COALESCE(SUM(CASE
      WHEN created_at >= date_trunc('day', now() AT TIME ZONE 'UTC')
      THEN cost_usd ELSE 0
    END), 0) AS daily_total,
    COALESCE(SUM(CASE
      WHEN created_at >= date_trunc('month', now() AT TIME ZONE 'UTC')
      THEN cost_usd ELSE 0
    END), 0) AS monthly_total
  FROM api_usage_log
  WHERE consultant_id = p_consultant_id
    AND provider = p_provider
    AND success = true;
$$;

-- Funcion: gasto global (todos los proveedores)
CREATE OR REPLACE FUNCTION get_global_spending(
  p_consultant_id UUID
)
RETURNS TABLE (
  daily_total NUMERIC,
  monthly_total NUMERIC
)
LANGUAGE sql
STABLE
SECURITY DEFINER
AS $$
  SELECT
    COALESCE(SUM(CASE
      WHEN created_at >= date_trunc('day', now() AT TIME ZONE 'UTC')
      THEN cost_usd ELSE 0
    END), 0) AS daily_total,
    COALESCE(SUM(CASE
      WHEN created_at >= date_trunc('month', now() AT TIME ZONE 'UTC')
      THEN cost_usd ELSE 0
    END), 0) AS monthly_total
  FROM api_usage_log
  WHERE consultant_id = p_consultant_id
    AND success = true;
$$;

-- ════════════════════════════════════════════════════════════════
-- 6. VISTA: estadisticas de uso agregadas por dia
-- ════════════════════════════════════════════════════════════════
CREATE OR REPLACE VIEW usage_daily_stats AS
SELECT
  consultant_id,
  date_trunc('day', created_at)::date AS day,
  provider,
  model,
  service,
  COUNT(*) AS call_count,
  SUM(input_tokens) AS total_input_tokens,
  SUM(output_tokens) AS total_output_tokens,
  SUM(cost_usd) AS total_cost_usd,
  AVG(duration_ms)::integer AS avg_duration_ms,
  SUM(CASE WHEN success THEN 1 ELSE 0 END) AS success_count,
  SUM(CASE WHEN NOT success THEN 1 ELSE 0 END) AS error_count
FROM api_usage_log
GROUP BY consultant_id, date_trunc('day', created_at)::date, provider, model, service;

-- Notificar a PostgREST para que detecte las nuevas tablas
NOTIFY pgrst, 'reload schema';
