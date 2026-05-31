# Rediseño del pipeline de ingesta RAG (Google Drive → pgvector)

> Estado: **propuesta**. Diagnóstico + plan de migración por fases.
> Ámbito: `residuos-ia-pro` (backend FastAPI en Railway + Supabase/pgvector).

## TL;DR — veredicto

La forma actual de enriquecer el RAG **no es la mejor práctica**. No por las piezas
de bajo nivel (que están bien: embeddings e inserts ya van en lote, hay skip
idempotente), sino por la **arquitectura de ejecución**: un job de ~6 horas corre
**dentro del proceso web** sobre un contenedor efímero de Railway que se reinicia
con cada deploy/OOM/mantenimiento, matando el sync en vuelo y obligando a
re-escanear los 10.000+ ficheros desde cero.

Resultado observado en `gdrive_sync_log`: corridas de 6–13 h que terminan en
`error` con mensajes como *"Sync interrumpido por reinicio del servidor"*,
*"Container Railway reiniciado"* y *"Sync expirado: superó 120 minutos"*, con filas
`running` huérfanas y solapadas.

**Objetivo del rediseño:** que un re-sync en régimen normal pase de **6 h frágiles**
a **minutos**, y que un reinicio cueste *un fichero*, no la corrida entera.

---

## 1. Arquitectura actual (as-is)

### 1.1 Dónde corre

- `Procfile`: `web: uvicorn api.server:app ...` — **un único proceso web, sin worker**.
- `railway.json`: `restartPolicyType: ON_FAILURE`, `restartPolicyMaxRetries: 10`.
- El sync de Drive se ejecuta **en el mismo proceso** que sirve las API requests.
- Al arrancar, el server hace *zombie cleanup*: marca todas las filas
  `status='running'` como `error` con `"Sync interrumpido por reinicio del servidor"`.
  Es decir: **cada reinicio del proceso aborta el sync activo**.

### 1.2 El flujo de ingesta (lo que SÍ está bien)

- **Escaneo de Drive**: `pipeline/google_drive.py::list_all_files_recursive` recorre
  el árbol en BFS (cola, no recursión), con `time.sleep(0.1)` entre carpetas y
  reintentos con backoff (`_RETRY_DELAYS = [1,2,4,8]`) ante 429/5xx.
- **Embeddings en lote**: `pipeline/config.py::EmbeddingService.embed_all` agrupa en
  `EMBED_BATCH_SIZE = 50` por llamada a OpenAI (`text-embedding-3-large`, 1536 dims),
  con retries y subdivisión de chunks > `MAX_EMBED_WORDS`.
- **Inserts de chunks en lote**: `pipeline/storage.py::save_chunks_to_supabase`
  hace upsert en lotes de 20, con dedup por `chunk_id` y filtro de chunks < 50 chars.
- **Idempotencia / skip incremental**: `doc_id = sha256(pdf_bytes + client_id)[:16]`,
  todo por `upsert`. Hay `content_hash` y un índice
  `idx_knowledge_docs_drive ON knowledge_documents(drive_file_id)`. El loop de sync
  construye un set `indexed_ids` de `drive_file_id` ya ingeridos y los salta
  (de ahí los ~3.700 *skipped* por corrida).

### 1.3 Lo que NO está bien (causas raíz)

| # | Problema | Evidencia | Efecto |
|---|----------|-----------|--------|
| 1 | **Ingesta dentro del proceso web** | `Procfile` solo `web:`; zombie-cleanup al arrancar | Cada deploy/OOM/reinicio mata el sync |
| 2 | **No es reanudable de verdad** | No hay cursor/checkpoint persistido; re-lista todo el árbol | Tras una caída, re-escanea los 10.248 desde cero |
| 3 | **Ficheros procesados en serie** | ~8 docs/min observados; `for`+`await` por fichero | Cuello de botella; horas para miles de docs |
| 4 | **Full-scan en vez de incremental** | BFS completo + `sleep(0.1)` × miles de carpetas | Minutos solo en escanear, aunque no cambie nada |
| 5 | **Watchdog dentro del proceso** | timeout de 120 min vive en el mismo server | Si el contenedor muere, el watchdog también → filas huérfanas |
| 6 | **Sin lock anti-solapamiento robusto** | filas `running` solapadas en los logs | 2 syncs compitiendo por Drive/OpenAI/Railway |

> Nota: la estructura de carpetas en Drive es enorme (19 CCAA × provincias × 16 tipos
> de gestor × subcarpetas → miles de carpetas), lo que amplifica el coste del full-scan (#4).

---

## 2. Arquitectura objetivo (to-be)

```
┌─────────────┐     enqueue      ┌──────────────────┐     claim/process   ┌─────────────┐
│  Web (API)  │ ───────────────▶ │  ingest_jobs     │ ◀────────────────── │  Worker(s)  │
│ FastAPI     │  1 fichero=1 job │  (cola en Supabase)│  con reintentos    │ (proceso     │
│ (requests)  │                  └──────────────────┘                     │  separado)   │
└─────────────┘                                                            └─────────────┘
        │                                                                         │
        │ POST /sync  ─▶ Drive changes.list (pageToken persistido)                │ embed+upsert
        ▼                                                                         ▼
  encola SOLO lo que cambió                                          Supabase (pgvector)
```

Principios:

1. **Desacoplar ingesta del web server** → worker/proceso separado. Un reinicio del
   web ya no afecta al sync.
2. **Unidad de trabajo pequeña y reanudable**: 1 fichero = 1 job en cola, con estado
   (`pending/processing/done/failed`) y reintentos. Una caída cuesta *un* job.
3. **Sync incremental por cambios** (Drive `changes.list` + `startPageToken`
   persistido) en lugar de full-scan. Régimen normal: procesar los pocos que cambiaron.
4. **Concurrencia acotada** en la ingesta (semáforo 5–10), respetando rate limits.
5. **Watchdog/heartbeat fuera del proceso** de trabajo (o vía `processing` + TTL en la cola).

---

## 3. Plan de migración por fases (priorizado por esfuerzo/impacto)

### Fase 0 — Parar el sangrado (horas, riesgo bajo)

*Quick wins que no requieren rediseño y reducen el daño inmediato.*

- [x] **`force-dynamic` en las API routes** (PR #189) — desbloquea los builds de Vercel.
- [ ] **Arreglar el watchdog + heartbeat** (ya hay branch `fix/watchdog-heartbeat-and-stats-rpc`):
      heartbeat periódico en la fila `running` y expiración por *falta de heartbeat*,
      no por reloj absoluto. Mergear tras revisión.
- [ ] **Lock anti-solapamiento**: antes de arrancar un sync, rechazar si ya hay uno
      `running` con heartbeat reciente (Postgres advisory lock o `SELECT ... FOR UPDATE`
      sobre una fila de control). Evita corridas solapadas.
- [ ] **Zombie-cleanup más fino**: distinguir "muerto" (sin heartbeat > N min) de
      "vivo"; no marcar `error` indiscriminadamente al arrancar.

**Impacto:** elimina huérfanos y solapamientos; los builds dejan de caerse. **No** arregla la lentitud ni la fragilidad de fondo.

### Fase 1 — Reanudabilidad + escaneo incremental (1–2 días, impacto ALTO)

*El mayor retorno por esfuerzo: convierte 6 h en minutos en régimen normal.*

- [ ] **Persistir `startPageToken` por consultor** (tabla `gdrive_sync_state`).
- [ ] **Sustituir el full-scan por `changes.list`**: en cada sync, pedir solo los
      ficheros cambiados desde el último token. El BFS completo queda solo para el
      *bootstrap* inicial o un re-index manual.
- [ ] **Checkpoint de progreso**: persistir qué ficheros quedan por procesar (ver Fase 2,
      la cola lo cubre de forma natural).

**Impacto:** un re-sync típico pasa de "recorrer 10.248" a "procesar los N que cambiaron".

### Fase 2 — Sacar la ingesta del web server (2–3 días, impacto ALTO)

*El arreglo estructural. Hace el sistema robusto a reinicios.*

- [ ] **Tabla cola `ingest_jobs`** en Supabase: `(id, drive_file_id, drive_modified_time,
      status, attempts, locked_by, locked_at, last_heartbeat, error, created_at)`.
- [ ] **Productor**: el endpoint `/sync` (o un cron) solo **encola** los ficheros
      cambiados (Fase 1) y vuelve enseguida. Nada de trabajo pesado en el request.
- [ ] **Worker separado**: nuevo proceso (Railway *worker service* o
      `worker: python -m worker.run` en `Procfile`) que hace *claim* de jobs
      (`UPDATE ... SET status='processing', locked_by=... WHERE status='pending'
      ... RETURNING` o `FOR UPDATE SKIP LOCKED`), procesa con el pipeline existente
      (`UnifiedIngestionService.ingest`) y marca `done`/`failed` con reintentos.
- [ ] **Recuperación automática**: jobs `processing` sin heartbeat > TTL vuelven a
      `pending`. Un reinicio del worker reencola solo los jobs en vuelo.

**Impacto:** un deploy/reinicio deja de ser catastrófico; el coste es *un* job re-encolado.

### Fase 3 — Concurrencia acotada (1 día, impacto MEDIO-ALTO)

- [ ] Procesar varios jobs en paralelo con `asyncio.gather` + `asyncio.Semaphore(5–10)`,
      o varias réplicas del worker (la cola con `SKIP LOCKED` ya es segura para N workers).
- [ ] Ajustar al rate limit de OpenAI embeddings y de Drive. Backoff ya existe.

**Impacto:** 5–10× en throughput de ingesta. (El loop actual es secuencial: ~8 docs/min.)

### Fase 4 — Observabilidad (0.5–1 día, impacto MEDIO)

- [ ] Métricas por corrida: docs/min, % con embedding, jobs fallidos, latencia p50/p95.
- [ ] Heartbeat externo / alerta si la cola no avanza en X min.
- [ ] Endpoint de health ya existente (`/api/knowledge-base/health`) extendido con la cola.

---

## 4. Cambios de esquema (Supabase)

```sql
-- Fase 1: cursor incremental de Drive por consultor
CREATE TABLE IF NOT EXISTS gdrive_sync_state (
  consultant_id   text PRIMARY KEY,
  start_page_token text,
  last_full_scan   timestamptz,
  updated_at       timestamptz DEFAULT now()
);

-- Fase 2: cola de ingesta (1 fichero = 1 job)
CREATE TABLE IF NOT EXISTS ingest_jobs (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  drive_file_id       text NOT NULL,
  drive_modified_time timestamptz,
  status              text NOT NULL DEFAULT 'pending'
                        CHECK (status IN ('pending','processing','done','failed')),
  attempts            int  NOT NULL DEFAULT 0,
  locked_by           text,
  locked_at           timestamptz,
  last_heartbeat      timestamptz,
  error               text,
  created_at          timestamptz DEFAULT now(),
  UNIQUE (drive_file_id)
);
CREATE INDEX IF NOT EXISTS idx_ingest_jobs_pending
  ON ingest_jobs (created_at) WHERE status = 'pending';
```

Claim seguro para N workers:

```sql
UPDATE ingest_jobs
   SET status='processing', locked_by=:worker, locked_at=now(), last_heartbeat=now()
 WHERE id = (
   SELECT id FROM ingest_jobs
    WHERE status='pending'
    ORDER BY created_at
    FOR UPDATE SKIP LOCKED
    LIMIT 1
 )
RETURNING *;
```

---

## 5. Riesgos y rollback

- **Reutiliza el pipeline existente** (`UnifiedIngestionService`, `EmbeddingService`,
  `StorageService`): el rediseño cambia *cómo se orquesta*, no *cómo se procesa* cada
  fichero → bajo riesgo en la lógica de extracción/embedding.
- **Idempotencia ya garantizada** (`upsert` por `doc_id`/`content_hash`): re-procesar un
  job no duplica datos.
- **Migración incremental**: cada fase aporta valor por sí sola y es reversible.
  Fase 0 y 1 no tocan la topología de despliegue; Fase 2 sí (añade worker) — se puede
  desplegar el worker en paralelo al sync inline y conmutar con un flag.
- **Coste**: un worker service adicional en Railway. Despreciable frente a las horas
  de cómputo desperdiciadas hoy en re-escaneos.

---

## 6. Mapa de ficheros relevantes

| Pieza | Fichero |
|------|---------|
| Servidor + endpoint de sync + zombie-cleanup + watchdog | `api/server.py` |
| Escaneo/descarga de Drive | `pipeline/google_drive.py` |
| Orquestación de ingesta por formato | `pipeline/unified_ingestion.py` |
| Embeddings en lote | `pipeline/config.py` (`EmbeddingService`) |
| Persistencia docs/chunks + storage | `pipeline/storage.py` |
| Esquema (incl. `gdrive_sync_log`, índice `drive_file_id`) | `supabase/setup.sql` |
| Arranque del proceso | `Procfile`, `railway.json` |
| Fix watchdog/heartbeat en curso | branch `fix/watchdog-heartbeat-and-stats-rpc` |

---

## 7. Orden recomendado

1. **Fase 0** (hoy): mergear watchdog + lock → para huérfanos y solapamientos.
2. **Fase 1** (esta semana): `changes.list` incremental → mata el re-escaneo de 6 h.
3. **Fase 2**: worker + cola → robustez ante reinicios.
4. **Fase 3**: concurrencia → velocidad.
5. **Fase 4**: observabilidad.

Fases 0+1 ya eliminan ~90% del dolor actual con esfuerzo bajo. Fase 2 es la que
convierte el sistema en algo que no hay que vigilar.
