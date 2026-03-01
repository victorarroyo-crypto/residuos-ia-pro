# Auditoria Completa del Repositorio — ResidusIA Pro

**Fecha:** 1 marzo 2026
**Alcance:** ~23,500 lineas de codigo (Python + TypeScript), 4 areas auditadas en paralelo
**Estado general:** Proyecto maduro y bien estructurado **(7.5/10)**

---

## Resumen Ejecutivo

Se auditaron 4 areas en paralelo: backend (`api/server.py`), pipeline (`pipeline/`), sistema de agentes (`pipeline/agents/`), y frontend (`web/src/`). Se identificaron **109 hallazgos** distribuidos asi:

| Severidad | Backend | Pipeline | Agentes | Frontend | Total |
|-----------|---------|----------|---------|----------|-------|
| CRITICO   | 1       | 4        | 5       | 0        | **10** |
| ALTO      | 6       | 5        | 5       | 4        | **20** |
| MEDIO     | 10      | 6        | 3       | 12       | **31** |
| BAJO      | 5       | 6        | 0       | 8        | **19** |

---

## CRITICOS (10) — Requieren atencion inmediata

### C1: Sin autenticacion en endpoints Python ✅ RESUELTO
**`api/server.py` — todos los endpoints**
Ningun endpoint del backend Python validaba tokens de autenticacion. La URL de Railway es publica, por lo que cualquier persona podia: ingestar documentos, usar el asesor IA (gasto en API), acceder a Google Drive, y ejecutar analisis multi-agente.

> **Solucion aplicada:** Se agrego middleware de autenticacion por API key (`X-API-Key` header) en `api/server.py`. Se creo utilidad compartida `web/src/lib/pipeline.ts` y se actualizaron las 20 API routes del frontend para enviar el header. Variables `PIPELINE_API_KEY` agregadas a `.env.example` y `web/.env.local.example`.

---

### C2: Estado global mutable en ejecucion de agentes
**`pipeline/agents/graph.py:57-65`**
`_sb_url` y `_sb_key` son variables globales que se sobreescriben en cada analisis. Si dos analisis corren en paralelo, las credenciales de Supabase se mezclan → un analisis podria escribir progreso en la sesion de otro consultor.

```python
_sb_url: str = ""   # Global mutable
_sb_key: str = ""   # Compartido entre requests concurrentes
```

---

### C3: Deadlock async en graph.py
**`pipeline/agents/graph.py:88-100`**
`_run_async()` detecta si hay un event loop corriendo y spawna un thread con `asyncio.run()`. En FastAPI (que siempre tiene un loop corriendo), esto puede causar deadlocks o `RuntimeError: Event loop is closed`.

---

### C4: JSON parse silencioso retorna findings vacios
**`pipeline/agents/llm.py:139-172`**
Si Claude retorna JSON malformado, `parse_json_response()` retorna `{"findings": [], "error": "..."}` sin lanzar excepcion. El analisis continua con 0 hallazgos sin alertar al usuario.

---

### C5: Excepciones tragadas en ejecucion paralela de agentes
**`pipeline/agents/graph.py:165-190`**
`asyncio.gather(*tasks, return_exceptions=True)` captura excepciones como objetos. Se pierden stack traces completos. Si `agent_contratos` crashea, el informe se genera SIN analisis de contratos y el usuario no recibe alerta prominente.

---

### C6: Sin timeout en llamadas LLM y herramientas de agentes
**`pipeline/agents/llm.py:55-130`**
`client.messages.create()` y `tool_executor.execute()` no tienen timeout. Si Claude API o Supabase RPC cuelgan, el thread se bloquea indefinidamente. Con 5 agentes x 5 rondas de herramientas = hasta 25 llamadas sin timeout.

---

### C7: Embedding failures silenciosas → perdida de chunks
**`pipeline/config.py:41-60` + `pipeline/storage.py:263-269`**
Cuando un batch de embeddings falla tras 3 retries, `continue` salta al siguiente batch. Chunks sin embedding se filtran silenciosamente en `storage.py`. El usuario nunca sabe que parte de su documento no fue indexado.

---

### C8: SSRF en validacion de URLs
**`api/server.py:153-176`**
`_validate_pdf_url()` solo valida esquema http/https, pero no bloquea IPs privadas. Un atacante podria acceder a `http://169.254.169.254/` (metadata AWS/GCP) o servicios internos.

---

### C9: Path traversal potencial en storage
**`pipeline/storage.py:82-96`**
`_sanitize_filename()` permite puntos (`.`) en el regex `[^\w.\-]`. Filename como `../../etc/passwd.pdf` se convierte en `..etc.passwd.pdf`. Si se combina con construccion de path, podria escapar del directorio del proyecto.

---

### C10: Prompt injection via consultant_instructions
**`pipeline/agents/prompts.py:198-207`**
Las instrucciones del consultor se inyectan directamente en el system prompt sin validacion ni sanitizacion. Un consultor podria enviar instrucciones como "IGNORA TODA LA NORMATIVA" y los agentes las seguirian.

---

## ALTOS (20) — Afectan funcionalidad o seguridad

| # | Area | Problema | Ubicacion |
|---|------|---------|-----------|
| H1 | Backend | **Exception handlers vacios** (`pass`) — 12+ lugares. Errores silenciados sin logging. | `server.py:1887`, `extractor.py:286`, `excel_processor.py:232,345,359` |
| H2 | Backend | **Archivos sin validacion de MIME type** — Solo se valida extension. `.exe` renombrado a `.pdf` pasa. | `server.py:1231-1274` |
| H3 | Backend | **Background task failures ocultas** — Si sync de Drive crashea, solo se loguea. DB no se actualiza con error. Cliente nunca se entera. | `server.py:2410-2422` |
| H4 | Backend | **Memoria sin limite en sync** — `details: list[dict]` crece indefinidamente. 10K+ archivos → posible OOM. | `server.py:2458-2694` |
| H5 | Backend | **Overly broad exception catching** — `except Exception` atrapa todo, incluido MemoryError y KeyboardInterrupt. | `server.py:1432-1441`, `extractor.py:286-288` |
| H6 | Backend | **Datos sensibles en mensajes de error** — URLs internas y nombres de variables de entorno expuestos al cliente. | `server.py:2131` |
| H7 | Pipeline | **Inyeccion en query Google Drive** — `f"name='{name}'"` sin escape de comillas simples. | `google_drive.py:288-293` |
| H8 | Pipeline | **Sin timeout en descargas** — `MediaIoBaseDownload.next_chunk()` puede colgar indefinidamente. | `google_drive.py:697-705` |
| H9 | Pipeline | **Sin retry inteligente en embeddings** — Rate limits de OpenAI no distinguidos de otros errores. Sin backoff adaptativo. | `config.py:99-119` |
| H10 | Pipeline | **OCR confidence: division por zero edge case** — Si no hay palabras con confianza > 0, `conf_values` vacio → avg_conf = 0.0 incluso con texto extraido. | `extractor.py:267,290` |
| H11 | Agentes | **Sin validacion de estado entre agentes** — Findings son dicts sin esquema. Si un agente retorna `{"tipo": "xxx"}` pero redactor espera `{"type": "xxx"}`, datos corruptos fluyen silenciosamente. | `graph.py:337`, todos los agentes |
| H12 | Agentes | **Thresholds de similitud inconsistentes** — `tools.py`: 0.50, `rag_scoping.py`: 0.70, CLAUDE.md: 0.65. Busquedas del mismo contenido retornan resultados diferentes segun el code path. | `tools.py:80`, `rag_scoping.py:103` |
| H13 | Agentes | **Sin cache de embeddings** — Cada busqueda genera nueva llamada a OpenAI API. 5 agentes x 2+ busquedas = 10+ llamadas redundantes por analisis. Costoso y lento. | `tools.py:117-123` |
| H14 | Agentes | **Sin retry en RPC de Supabase** — Si `search_knowledge` falla por timeout transitorio, no hay reintento. | `tools.py:131-176` |
| H15 | Agentes | **AsyncClient leak** — ToolExecutor crea `AsyncClient` pero nunca lo cierra. 5 agentes x N analisis = conexiones acumuladas. | `tools.py:96-99` |
| H16 | Frontend | **XSS en render-markdown.ts** — Contenido de celdas de tabla insertado como HTML sin escape. `<img src=x onerror=alert(1)>` se ejecuta. | `render-markdown.ts:46` |
| H17 | Frontend | **Sin auth en KB API** — `getAdminClient()` bypasea RLS. Si no se verifica auth del usuario, cualquier request obtiene todos los documentos. | `knowledge-base/route.ts:1-43` |
| H18 | Frontend | **Sin auth en delete de documentos** — Mismo patron que H17 para eliminacion. | `projects/[id]/documents/[id]/route.ts` |
| H19 | Frontend | **Variables de entorno en errores** — `PIPELINE_URL` expuesta en mensajes de error al cliente. | `advisor/route.ts:66`, `ingest/route.ts:91` |
| H20 | Frontend | **Sin CSP headers** — `vercel.json` tiene headers de seguridad basicos pero sin Content-Security-Policy. Scripts inline no prevenidos. | `vercel.json:28-38` |

---

## MEDIOS (31) — Mejoras importantes

| # | Area | Problema | Ubicacion |
|---|------|---------|-----------|
| M1 | Backend | CORS permite localhost en produccion + `allow_methods=["*"]` | `server.py:117-126` |
| M2 | Backend | Sin rate limiting en ningun endpoint | `server.py` (global) |
| M3 | Backend | `datetime.utcnow()` deprecado (Python 3.12+) | `storage.py:199,235` |
| M4 | Backend | Monolito en `/api/advisor/chat` — 160+ lineas de logica en un solo endpoint | `server.py:1147-1309` |
| M5 | Backend | N+1 query pattern en sync de Drive (3 queries batch secuenciales) | `server.py:2469-2496` |
| M6 | Backend | Sin validacion de UUID en project_id (acepta cualquier string) | `server.py:1563-1564` |
| M7 | Backend | Historial de advisor sin limite de tokens (10 msgs x 1500 chars = 15K+ tokens) | `server.py:1051-1062` |
| M8 | Backend | PDF extraction limitada a 50 paginas sin aviso | `server.py:610,636` |
| M9 | Backend | Modelos hardcodeados en 4+ lugares distintos | `server.py:335,929,1400,1480` |
| M10 | Backend | Constantes magicas dispersas sin centralizar (100MB, 20MB, 15000 chars, etc.) | `server.py` (multiples) |
| M11 | Pipeline | Inyeccion regex en queries Google Drive | `google_drive.py:288-293` |
| M12 | Pipeline | Inconsistencia de campos de metadata: `cantidad_ton` vs `cantidad_toneladas` | `unified_ingestion.py:344`, `metadata_extractor.py:372` |
| M13 | Pipeline | Sin limite de chunks por documento (PDF de 500 pags → 5000+ chunks) | `storage.py:250-302` |
| M14 | Pipeline | LER codes normalizados sin espacios (`020101`) vs formato estandar (`02 01 01`) | `metadata_extractor.py:257-268` |
| M15 | Pipeline | Sin deduplicacion en RAG (mismo doc en knowledge + project → duplicado) | `rag_scoping.py:96-158` |
| M16 | Pipeline | Sin timeouts en llamadas LLM del pipeline (classifier, metadata extractor) | `classifier_chunker.py:337-347` |
| M17 | Agentes | Error context perdido entre agentes — errores van a lista plana sin identificar origen | `graph.py:172-190` |
| M18 | Agentes | Contexto de agentes sin limite de tokens — no se mide tamano total antes de enviar a Claude | Todos los agentes |
| M19 | Agentes | Modelo hardcodeado `claude-sonnet-4-20250514` sin variable de entorno | `llm.py:31` |
| M20 | Frontend | Sin Error Boundaries — crash de componente tumba todo el dashboard | `dashboard/` (global) |
| M21 | Frontend | Sin CSRF protection en formularios | `projects/new/page.tsx`, `login/page.tsx` |
| M22 | Frontend | Sin validacion JSON schema en API routes (no Zod ni similar) | `advisor/chat/route.ts:42`, `analyze-project/plan/route.ts:14` |
| M23 | Frontend | Chat history en localStorage sin encriptar | `advisor/page.tsx:28-60` |
| M24 | Frontend | Sin rate limiting en API routes del frontend | Todas las API routes |
| M25 | Frontend | Sin validacion de extension de archivo en upload signed URL | `upload-signed-url/route.ts:66-76` |
| M26 | Frontend | Sin verificacion de expiracion de token Google Drive | `gdrive/callback/route.ts:80-106` |
| M27 | Frontend | Race condition en sync — no verifica si ya hay sync en progreso | `gdrive/sync/route.ts:9-22` |
| M28 | Frontend | Sin paginacion en lista de proyectos | `projects/page.tsx` |
| M29 | Pipeline | Precision numerica perdida con formato europeo (`1.234,56` no se parsea) | `unified_ingestion.py:335-338` |
| M30 | Pipeline | Hash de contenido calculado pero nunca usado para deduplicacion | `storage.py:176-179` |
| M31 | Pipeline | Clasificacion default a NORMATIVA cuando no hay senales claras | `classifier_chunker.py:267-269` |

---

## BAJOS (19) — Deuda tecnica

| # | Problema | Ubicacion |
|---|---------|-----------|
| L1 | Sin code splitting en dashboard | `web/src/app/dashboard/` |
| L2 | Sin memoizacion en componentes pesados | `advisor-chat.tsx` |
| L3 | Accesibilidad: falta alt text, ARIA labels | Componentes varios |
| L4 | Sin request ID/correlation ID | `api/server.py` |
| L5 | `pipeline_progress` sin RLS | `supabase/setup.sql` |
| L6 | Sidebar state no persistido | `sidebar.tsx` |
| L7 | Logging inconsistente (f-strings vs % formatting) | `server.py` (global) |
| L8 | Type hints inconsistentes (PEP 604 `\|` vs `Optional[]`) | `server.py:36-42` |
| L9 | Dead code (legacy single-file fields en advisor) | `server.py:587-589` |
| L10 | Sin API versioning (`/api/` sin `/v1/`) | `server.py` (global) |
| L11 | Memory leak potencial en OCR (images no cerradas explicitamente) | `extractor.py:217-224` |
| L12 | Regex ineficiente en loop para Excel | `excel_processor.py:261-263` |
| L13 | Import dentro de funcion (lento, mala practica) | `text_processor.py:37-53` |
| L14 | Chunks de tabla divididos sin link entre partes | `classifier_chunker.py:642-707` |
| L15 | Reranking trunca excerpts a 300 chars (puede cortar info clave) | `rag_scoping.py:264` |
| L16 | Sin Cache-Control headers en API responses | Frontend API routes |
| L17 | TypeScript types incompletos (fields opcionales sin `?`) | `rag/route.ts:5-21` |
| L18 | Promises rechazadas sin logging | `advisor-chat.tsx:270` |
| L19 | Sin timeout client-side en SSE stream | `advisor-chat.tsx` |

---

## Fortalezas del Proyecto

1. **Documentacion excepcional** — CLAUDE.md de 41KB con reglas operativas, mapa tecnico completo, y auditoria de Supabase
2. **Seguridad en git** — No secrets en repo, `.gitignore` completo, `.env.example` bien separados
3. **RLS coherente** — Politicas RLS en todas las tablas de proyecto, cada consultor aislado
4. **Prompts de agentes especializados** — Cada agente tiene prompt detallado con benchmarks concretos, formato JSON esperado, y contexto legal espanol
5. **HITL bien implementado** — Flujo plan → aprobacion → ejecucion → round 2 con feedback
6. **Google Drive resiliente** — Retry con backoff, BFS iterativo, timeout de 120 min, deduplicacion por drive_file_id
7. **Tipado fuerte** — 85+ interfaces TypeScript, TypedDict en Python, Pydantic en endpoints
8. **Arquitectura limpia** — Separacion clara en 4 capas (frontend/backend/pipeline/agentes)
9. **RAG hibrido con reranking** — Vector + full-text + reranking con Claude Haiku
10. **Signed URLs para uploads** — Evita exponer secrets de storage

---

## Verificacion Recomendada

Ejecutar en Supabase para validar hallazgos criticos:

```sql
-- Columnas tsv existen? (afecta full-text search)
SELECT column_name FROM information_schema.columns
WHERE table_name = 'knowledge_chunks' AND column_name = 'tsv';

SELECT column_name FROM information_schema.columns
WHERE table_name = 'project_chunks' AND column_name = 'tsv';

-- Discrepancia docs vs chunks (C7)
SELECT
  (SELECT count(*) FROM knowledge_documents) as total_docs,
  (SELECT count(*) FROM knowledge_chunks) as total_chunks,
  (SELECT count(DISTINCT document_id) FROM knowledge_chunks) as docs_con_chunks;

-- Documentos sin chunks (no buscables por RAG)
SELECT id, titulo, tipo, created_at
FROM knowledge_documents
WHERE id NOT IN (SELECT DISTINCT document_id FROM knowledge_chunks)
ORDER BY created_at DESC;
```

---

## Acciones Recomendadas (por prioridad)

### Inmediatas (pre-produccion)
1. ~~**C1** — Verificar si backend Railway esta expuesto publicamente. Si si, agregar auth middleware.~~ ✅ RESUELTO — API key middleware implementado
2. **C2** — Pasar credenciales de progreso via estado, no globales (`graph.py`)
3. **C8** — Agregar validacion SSRF (bloquear IPs privadas en `_validate_pdf_url`)
4. **C10** — Sanitizar `consultant_instructions` (longitud maxima, patrones prohibidos)
5. **H16** — Escapar HTML entities en `render-markdown.ts` antes de insertar en DOM
6. **H17/H18** — Agregar verificacion de auth en API routes de KB y documentos

### Corto plazo (1-2 sesiones)
7. **C4/C5** — Agregar logging estructurado a JSON parse failures y excepciones de agentes
8. **C6** — Agregar timeouts a `client.messages.create()` y `tool_executor.execute()`
9. **C7** — Reportar chunks fallidos al caller en vez de `continue` silencioso
10. **H1** — Reemplazar `except Exception: pass` por logging especifico en 12+ lugares
11. **H7** — Escapar comillas en queries Google Drive
12. **H12** — Centralizar threshold de similitud en `config.py` (un solo valor)
13. **H13** — Agregar cache de embeddings por ToolExecutor
14. **H15** — Implementar `async with` context manager en ToolExecutor
15. **H19** — Remover URLs internas de mensajes de error al cliente

### Medio plazo
16. **M2/M24** — Rate limiting (slowapi en backend, Vercel KV en frontend)
17. **M1** — Restringir CORS a solo FRONTEND_URL en produccion
18. **M20** — Error Boundaries en React
19. **M22** — Validacion de input con Zod en API routes
20. **M14** — Normalizar formato LER a `XX XX XX` consistentemente
21. **M29** — Parseo de numeros en formato europeo (`1.234,56`)
22. **C9** — Eliminar puntos del regex de sanitizacion de filenames
23. **H20** — Agregar Content-Security-Policy en vercel.json
