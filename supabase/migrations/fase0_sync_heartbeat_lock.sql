-- ══════════════════════════════════════════════════════════════
-- Fase 0 — Sync liveness: heartbeat + atomic anti-overlap lock
-- ══════════════════════════════════════════════════════════════
-- Idempotent: safe to run multiple times.
--
-- 1. last_heartbeat column: a running sync refreshes this periodically; the
--    reaper marks rows error when it goes stale (replaces the passive 120-min
--    check and the kill-everything-on-restart behaviour).
-- 2. Index to make the reaper's "running + stale heartbeat" scan cheap.
-- 3. Atomic anti-overlap lock: at most one running sync per consultant,
--    enforced by a partial unique index. Concurrent POSTs that race past the
--    application-level check are rejected by the DB (unique violation 23505).

-- 1. Heartbeat column
ALTER TABLE gdrive_sync_log
  ADD COLUMN IF NOT EXISTS last_heartbeat TIMESTAMPTZ;

-- Backfill so existing rows have a sensible liveness value.
UPDATE gdrive_sync_log
  SET last_heartbeat = COALESCE(last_heartbeat, completed_at, started_at)
  WHERE last_heartbeat IS NULL;

-- New rows default to now(); the app also sets it explicitly on insert.
ALTER TABLE gdrive_sync_log
  ALTER COLUMN last_heartbeat SET DEFAULT now();

-- 2. Reaper scan index (running rows ordered by heartbeat)
CREATE INDEX IF NOT EXISTS idx_sync_log_running_heartbeat
  ON gdrive_sync_log (last_heartbeat)
  WHERE status = 'running';

-- 3. Resolve any pre-existing overlapping running rows BEFORE adding the unique
--    index, otherwise index creation would fail. Keep the most-recently-active
--    running row per consultant; mark the rest as error.
WITH ranked AS (
  SELECT id,
         row_number() OVER (
           PARTITION BY consultant_id
           ORDER BY COALESCE(last_heartbeat, started_at) DESC, started_at DESC
         ) AS rn
  FROM gdrive_sync_log
  WHERE status = 'running'
)
UPDATE gdrive_sync_log s
  SET status = 'error',
      completed_at = now(),
      error_message = COALESCE(s.error_message,
        'Sync duplicado cerrado al instaurar el lock anti-solapamiento.')
  FROM ranked
  WHERE s.id = ranked.id
    AND ranked.rn > 1;

-- Atomic anti-overlap lock: one running sync per consultant.
CREATE UNIQUE INDEX IF NOT EXISTS uq_sync_log_one_running_per_consultant
  ON gdrive_sync_log (consultant_id)
  WHERE status = 'running';
