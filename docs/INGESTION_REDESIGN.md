# Rediseño del pipeline de ingesta RAG (Google Drive → pgvector)

> Estado: **propuesta**. Diagnóstico + plan de migración por fases.
> Ámbito: `residuos-ia-pro` (backend FastAPI en Railway + Supabase/pgvector).
> Verificado contra `api/server.py` (4169 líneas) y el resto del pipeline.

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
- El sync de Drive se ejecuta **en el mismo proceso** que sirve las API requests:
  el endpoint `@app.post("/api/gdrive/sync")` (`api/server.py` L2776–2900) lanza el
  trabajo pesado con **`asyncio.create_task` (fire-and-forget)** — `_run_sync_job`
  (L2927–3350, ~424 líneas) — y responde al instante.
- Al arrancar (`lifespan`, L124–143), el server hace *zombie cleanup*: marca todas las
  filas `status='running'` como `error` con `"Sync interrumpido por reinicio del servidor"`.
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
- **Idempotencia**: `doc_id = sha256(pdf_bytes + client_id)[:16]`, todo por `upsert`;
  hay `content_hash` e índice `idx_knowledge_docs_drive ON knowledge_documents(drive_file_id)`.
- **Timeout por fichero**: cada ingesta individual tiene `timeout=300` s (L3184–3187).

### 1.3 Lo que NO está bien (causas raíz, verificadas)

| # | Problema | Evidencia (`api/server.py`) | Efecto |
|---|----------|------------------------------|--------|
| 1 | **Ingesta dentro del proceso web** | `Procfile` solo `web:`; `asyncio.create_task` L2881–2893; zombie-cleanup L124–143 | Cada deploy/OOM/reinicio mata el sync en vuelo |
| 2 | **No es reanudable** | `list_all_files_recursive` L3016; sin cursor/checkpoint | Tras una caída, re-escanea los 10.248 desde cero |
| 3 | **Procesamiento de facto SECUENCIAL** | lotes de 10 con `gather` PERO `Semaphore(1)` L3127–3128, comentado *"sequential to avoid memory crash (free(): invalid size)"* | ~8 docs/min; horas para miles de docs |
| 4 | **Full-scan en vez de incremental** | BFS completo + `sleep(0.1)` × miles de carpetas | Minutos solo en escanear, aunque no cambie nada |
| 5 | **No hay watchdog real ni heartbeat** | 0 ocurrencias de `watchdog`/`heartbeat`; el límite de 120 min (L2827–2853) es un check **PASIVO** que solo corre cuando llega un NUEVO POST al endpoint | Un zombi nunca se expira solo; filas `running` huérfanas indefinidas |
| 6 | **Guard de concurrencia no atómico** | check "ya hay running" L2813–2860 (check-then-insert, con race); sin advisory lock | 2 syncs solapados compitiendo por Drive/OpenAI/Railway |
| 7 | **El skip ignora `modifiedTime`** | `indexed_ids` por `drive_file_id`/`titulo` L3027–3076; sin `content_hash`/`md5`/`modifiedTime` | **Ficheros editados en Drive nunca se re-ingieren** (bug de corrección) |

> Notas:
> - La estructura de carpetas en Drive es enorme (19 CCAA × provincias × 16 tipos de
>   gestor × subcarpetas → miles de carpetas), lo que amplifica el coste del full-scan (#4).
> - El `Semaphore(1)` (#3) es un **parche a un crash de memoria** (`free(): invalid size`),
>   no una decisión de diseño → es un **bloqueante** para subir la concurrencia (Fase 3).

---

## 2. Arquitectura objetivo (to-be)

```
┌─────────────┐     enqueue      ┌──────────────────┐     claim/process   ┌────────────┐
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
   persistido) en lugar de full-scan; comparar `modifiedTime` para re-ingerir editados.
4. **Concurrencia acotada** en la ingesta (semáforo 5–10) — *tras* resolver el crash
   de memoria que hoy fuerza `Semaphore(1)`.
5. **Watchdog/heartbeat fuera del proceso** de trabajo (o vía `processing` + TTL en la cola).

---

## 3. Plan de migración por fases (priorizado por esfuerzo/impacto)

### Fase 0 — Parar el sangrado (horas, riesgo bajo)

*Quick wins que no requieren rediseño y reducen el daño inmediato.*

- [x] **`force-dynamic` en las API routes** (PR #189) — desbloquea los builds de Vercel.
- [ ] **Heartbeat + expiración activa** (hoy NO existe ninguno; ver branch
      `fix/watchdog-heartbeat-and-stats-rpc`): escribir `last_heartbeat` periódico en la
      fila `running`, y un proceso/cron que expire las que no laten en > N min. Sustituye
      al check pasivo de 120 min (que solo corre si llega un nuevo POST).
- [ ] **Lock anti-solapamiento atómico**: Postgres advisory lock
      (`pg_try_advisory_lock(hashtext(consultant_id))`) o `INSERT ... ON CONFLICT` sobre
      una fila de control, en vez del check-then-insert no atómico actual (L2813–2860).
- [ ] **Zombie-cleanup más fino**: distinguir "muerto" (sin heartbeat) de "vivo";
      no marcar `error` indiscriminadamente al arrancar.

**Impacto:** elimina huérfanos y solapamientos; los builds dejan de caerse. **No** arregla la lentitud ni la fragilidad de fondo.

### Fase 1 — Reanudabilidad + escaneo incremental (1–2 días, impacto ALTO)

*El mayor retorno por esfuerzo: convierte 6 h en minutos en régimen normal.*

- [ ] **Persistir `startPageToken` por consultor** (tabla `gdrive_sync_state`).
- [ ] **Sustituir el full-scan por `changes.list`**: en cada sync, pedir solo los
      ficheros cambiados desde el último token. El BFS completo queda solo para el
      *bootstrap* inicial o un re-index manual.
- [ ] **Re-ingerir editados**: comparar `modifiedTime` (o `md5Checksum`) contra lo
      guardado, para corregir el bug #7 (hoy un fichero editado se salta para siempre).

**Impacto:** un re-sync típico pasa de "recorrer 10.248" a "procesar los N que cambiaron".

### Fase 2 — Sacar la ingesta del web server (2–3 días, impacto ALTO)

*El arreglo estructural. Hace el sistema robusto a reinicios.*

- [ ] **Tabla cola `ingest_jobs`** en Supabase (ver §4).
- [ ] **Productor**: el endpoint `/sync` (o un cron) solo **encola** los ficheros
      cambiados (Fase 1) y vuelve enseguida. Nada de trabajo pesado en el request.
- [ ] **Worker separado**: nuevo proceso (Railway *worker service* o
      `worker: python -m worker.run` en `Procfile`) que hace *claim* de jobs
      (`FOR UPDATE SKIP LOCKED`), procesa con el pipeline existente
      (`UnifiedIngestionService.ingest`) y marca `done`/`failed` con reintentos.
- [ ] **Recuperación automática**: jobs `processing` sin heartbeat > TTL vuelven a
      `pending`. Un reinicio del worker reencola solo los jobs en vuelo.

**Impacto:** un deploy/reinicio deja de ser catastrófico; el coste es *un* job re-encolado.

### Fase 3 — Concurrencia acotada (1–2 días, impacto MEDIO-ALTO)

- [ ] **Resolver primero el crash de memoria** (`free(): invalid size`, L3128) que hoy
      obliga a `Semaphore(1)`. Suele venir de librerías nativas no thread/async-safe
      (PyMuPDF, OCR/Tesseract, python-magic) compartidas entre tareas concurrentes;
      aíslar por job (subproceso) o usar instancias separadas.
- [ ] Subir a `asyncio.Semaphore(5–10)`, o varias réplicas del worker (la cola con
      `SKIP LOCKED` ya es segura para N workers).
- [ ] Ajustar al rate limit de OpenAI embeddings y de Drive (backoff ya existe).

**Impacto:** 5–10× en throughput de ingesta.

### Fase 4 — Observabilidad (0.5–1 día, impacto MEDIO)

- [ ] Métricas por corrida: docs/min, % con embedding, jobs fallidos, latencia p50/p95.
- [ ] Alerta si la cola no avanza en X min.
- [ ] Extender `/api/knowledge-base/health` con el estado de la cola.

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
- **El crash de memoria es un riesgo conocido**: la Fase 3 no debe abordarse sin
  reproducir y arreglar `free(): invalid size` primero (ver Fase 3).
- **Migración incremental**: cada fase aporta valor por sí sola y es reversible.
  Fases 0 y 1 no tocan la topología de despliegue; Fase 2 sí (añade worker) — se puede
  desplegar el worker en paralelo al sync inline y conmutar con un flag.
- **Coste**: un worker service adicional en Railway. Despreciable frente a las horas
  de cómputo desperdiciadas hoy en re-escaneos.

---

## 6. Mapa de ficheros relevantes

| Pieza | Fichero / línea |
|------|------------------|
| Endpoint de sync (`asyncio.create_task`) | `api/server.py` L2776–2900 |
| Job de fondo `_run_sync_job` | `api/server.py` L2927–3350 |
| Zombie-cleanup al arrancar | `api/server.py` L124–143 |
| Check pasivo de 120 min (no watchdog) | `api/server.py` L2827–2853 |
| Skip `indexed_ids` (sin `modifiedTime`) | `api/server.py` L3027–3076 |
| `Semaphore(1)` por crash de memoria | `api/server.py` L3127–3128 |
| Loop por lotes de 10 + `gather` | `api/server.py` L3293–3299 |
| Escaneo/descarga de Drive | `pipeline/google_drive.py` |
| Orquestación de ingesta por formato | `pipeline/unified_ingestion.py` |
| Embeddings en lote | `pipeline/config.py` (`EmbeddingService`) |
| Persistencia docs/chunks + storage | `pipeline/storage.py` |
| Esquema (incl. `gdrive_sync_log`, índice `drive_file_id`) | `supabase/setup.sql` |
| Arranque del proceso | `Procfile`, `railway.json` |
| Fix heartbeat/watchdog en curso | branch `fix/watchdog-heartbeat-and-stats-rpc` |

---

## 7. Orden recomendado

1. **Fase 0** (hoy): heartbeat/expiración + lock atómico → para huérfanos y solapamientos.
2. **Fase 1** (esta semana): `changes.list` incremental + re-ingesta de editados → mata el re-escaneo de 6 h.
3. **Fase 2**: worker + cola → robustez ante reinicios.
4. **Fase 3**: arreglar crash de memoria → concurrencia → velocidad.
5. **Fase 4**: observabilidad.

Fases 0+1 ya eliminan ~90% del dolor actual con esfuerzo bajo. Fase 2 es la que
convierte el sistema en algo que no hay que vigilar.
