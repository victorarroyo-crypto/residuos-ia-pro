-- Fase 1: escaneo incremental de Google Drive (changes.list) +
-- re-ingesta de ficheros editados.
--
-- (1) gdrive_sync_state: cursor incremental por consultor (startPageToken
--     persistente entre syncs) y marca del ultimo full-scan, para alternar
--     entre escaneo incremental rapido y un re-scan periodico de seguridad.
-- (2) knowledge_documents.drive_modified_time: cuando se ingirio cada
--     documento, segun Drive. Sin esta columna, el sync no podia distinguir
--     un fichero editado de uno ya indexado (bug #7 del rediseno) y los
--     editados quedaban congelados en el RAG.

-- 1) Estado de sync por consultor (cursor de Drive changes API)
CREATE TABLE IF NOT EXISTS gdrive_sync_state (
  consultant_id     UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  start_page_token  TEXT,
  last_full_scan    TIMESTAMPTZ,
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE  gdrive_sync_state IS
  'Fase 1: cursor para Drive changes.list (sync incremental) por consultor.';
COMMENT ON COLUMN gdrive_sync_state.start_page_token IS
  'Token devuelto por Drive (changes.getStartPageToken / changes.list.newStartPageToken). Si es NULL → siguiente sync hace bootstrap (full-scan).';
COMMENT ON COLUMN gdrive_sync_state.last_full_scan IS
  'Timestamp del ultimo full-scan completado. Safety-net: si pasa demasiado tiempo, el sync hace otro full-scan aunque haya token, para corregir derivas.';

-- 2) drive_modified_time en knowledge_documents (necesario para detectar
--    ediciones tambien durante un full-scan).
ALTER TABLE knowledge_documents
  ADD COLUMN IF NOT EXISTS drive_modified_time TIMESTAMPTZ;

COMMENT ON COLUMN knowledge_documents.drive_modified_time IS
  'Fase 1: modifiedTime que tenia el fichero en Drive cuando se ingirio. Comparar con el modifiedTime actual permite detectar ficheros editados y re-ingerirlos (bug #7 del rediseno).';

-- Indice parcial para acelerar joins por drive_file_id (mismo patron que el
-- existente para drive_file_id).
CREATE INDEX IF NOT EXISTS idx_knowledge_docs_drive_mtime
  ON knowledge_documents(drive_file_id, drive_modified_time)
  WHERE drive_file_id IS NOT NULL;
