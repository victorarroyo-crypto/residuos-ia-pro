-- Fase 4: observabilidad. Una funcion que consolida en un solo JSON el estado
-- operativo del sync + cola de ingesta, para alimentar un endpoint /api/sync/metrics
-- (y, mas adelante, alertas si la cola no avanza).

CREATE OR REPLACE FUNCTION sync_metrics()
RETURNS JSONB
LANGUAGE sql
STABLE
AS $$
  SELECT jsonb_build_object(
    'generated_at', now(),

    -- Cola de ingesta (Fase 2): conteo por estado.
    'queue', (
      SELECT jsonb_object_agg(status, n)
      FROM (
        SELECT status, count(*) AS n FROM ingest_jobs GROUP BY status
      ) q
    ),
    'queue_total', (SELECT count(*) FROM ingest_jobs),

    -- Job mas antiguo aun pendiente (señal de atasco si crece).
    'oldest_pending_age_seconds', (
      SELECT round(EXTRACT(EPOCH FROM (now() - min(created_at))))::int
      FROM ingest_jobs WHERE status = 'pending'
    ),
    -- Jobs terminados en la ultima hora (throughput aproximado).
    'done_last_hour', (
      SELECT count(*) FROM ingest_jobs
      WHERE status = 'done' AND updated_at > now() - interval '1 hour'
    ),
    'failed_last_hour', (
      SELECT count(*) FROM ingest_jobs
      WHERE status = 'failed' AND updated_at > now() - interval '1 hour'
    ),

    -- Sync activo (si lo hay): edad y frescura del heartbeat.
    'active_sync', (
      SELECT jsonb_build_object(
        'id', id,
        'phase', details->>'phase',
        'age_seconds', round(EXTRACT(EPOCH FROM (now() - started_at)))::int,
        'heartbeat_age_seconds', round(EXTRACT(EPOCH FROM (now() - last_heartbeat)))::int,
        'total_files_found', total_files_found,
        'files_ingested', files_ingested,
        'files_failed', files_failed
      )
      FROM gdrive_sync_log
      WHERE status = 'running'
      ORDER BY started_at DESC
      LIMIT 1
    ),

    -- Estado incremental (Fase 1): cuantos consultores tienen cursor y
    -- cuando fue el ultimo full-scan mas reciente.
    'incremental', jsonb_build_object(
      'consultants_with_cursor', (SELECT count(*) FROM gdrive_sync_state WHERE start_page_token IS NOT NULL),
      'last_full_scan', (SELECT max(last_full_scan) FROM gdrive_sync_state)
    ),

    -- Corpus indexado.
    'corpus', jsonb_build_object(
      'documents', (SELECT count(*) FROM knowledge_documents),
      'with_drive_modified_time', (SELECT count(*) FROM knowledge_documents WHERE drive_modified_time IS NOT NULL)
    )
  );
$$;

COMMENT ON FUNCTION sync_metrics() IS
  'Fase 4: snapshot consolidado (cola de ingesta, sync activo, estado incremental, corpus) para /api/sync/metrics.';
