-- Fase 2: cola de ingesta (1 fichero = 1 job) + claim atomico para worker(s).
--
-- Desacopla la ingesta del request web: el sync (productor) solo ENCOLA los
-- ficheros que cambiaron y vuelve enseguida; un consumidor de fondo procesa
-- los jobs de uno en uno con reintentos. Una caida cuesta *un* job (que se
-- reencola por TTL), no la corrida entera.
--
-- Esta migracion es inerte hasta que el backend arranca con SYNC_USE_QUEUE=1.

-- 1) Cola
CREATE TABLE IF NOT EXISTS ingest_jobs (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  consultant_id       UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  drive_file_id       TEXT NOT NULL,
  drive_modified_time TIMESTAMPTZ,
  file_name           TEXT,
  status              TEXT NOT NULL DEFAULT 'pending'
                        CHECK (status IN ('pending','processing','done','failed')),
  attempts            INT  NOT NULL DEFAULT 0,
  max_attempts        INT  NOT NULL DEFAULT 3,
  locked_by           TEXT,
  locked_at           TIMESTAMPTZ,
  last_heartbeat      TIMESTAMPTZ,
  error               TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Re-encolar un fichero (p. ej. editado de nuevo) hace upsert sobre esta clave.
  UNIQUE (consultant_id, drive_file_id)
);

-- Indice para el claim (solo pendientes, por orden de llegada).
CREATE INDEX IF NOT EXISTS idx_ingest_jobs_pending
  ON ingest_jobs (created_at) WHERE status = 'pending';
-- Indice para el reaper (jobs en proceso por antiguedad de heartbeat).
CREATE INDEX IF NOT EXISTS idx_ingest_jobs_processing
  ON ingest_jobs (last_heartbeat) WHERE status = 'processing';

COMMENT ON TABLE ingest_jobs IS
  'Fase 2: cola de ingesta (1 fichero = 1 job). Productor: endpoint /sync. Consumidor: worker de fondo (SYNC_USE_QUEUE=1).';

-- 2) Claim atomico para N workers: coge el job pendiente mas antiguo con
--    FOR UPDATE SKIP LOCKED, lo marca processing y devuelve la fila.
CREATE OR REPLACE FUNCTION claim_ingest_job(p_worker TEXT)
RETURNS SETOF ingest_jobs
LANGUAGE sql
AS $$
  UPDATE ingest_jobs
     SET status         = 'processing',
         locked_by      = p_worker,
         locked_at      = now(),
         last_heartbeat = now(),
         attempts       = attempts + 1,
         updated_at     = now()
   WHERE id = (
     SELECT id
       FROM ingest_jobs
      WHERE status = 'pending'
      ORDER BY created_at
      FOR UPDATE SKIP LOCKED
      LIMIT 1
   )
  RETURNING *;
$$;

COMMENT ON FUNCTION claim_ingest_job(TEXT) IS
  'Fase 2: reclama atomicamente el siguiente job pendiente (FOR UPDATE SKIP LOCKED). Seguro para N workers.';

-- 3) Reaper de jobs colgados: los que llevan demasiado en processing sin
--    heartbeat vuelven a pending (o a failed si agotaron intentos).
CREATE OR REPLACE FUNCTION requeue_stale_ingest_jobs(p_ttl_seconds INT)
RETURNS INT
LANGUAGE sql
AS $$
  WITH stale AS (
    UPDATE ingest_jobs
       SET status    = CASE WHEN attempts >= max_attempts THEN 'failed' ELSE 'pending' END,
           locked_by = NULL,
           locked_at = NULL,
           error     = CASE WHEN attempts >= max_attempts
                            THEN 'Reaped: worker murio y se agotaron los intentos'
                            ELSE error END,
           updated_at = now()
     WHERE status = 'processing'
       AND last_heartbeat < now() - make_interval(secs => p_ttl_seconds)
    RETURNING 1
  )
  SELECT count(*)::INT FROM stale;
$$;

COMMENT ON FUNCTION requeue_stale_ingest_jobs(INT) IS
  'Fase 2: reencola (o marca failed) jobs en processing cuyo heartbeat expiro. Recupera el trabajo de un worker caido.';
