# CLAUDE.md - ResidusIA Pro

## Reglas de comportamiento (OBLIGATORIAS)

1. **NUNCA implementar sin aprobación de Víctor.** Antes de escribir o modificar cualquier archivo de código, presentar el plan completo y esperar aprobación explícita. Esto incluye: nuevos archivos, ediciones de archivos existentes, migraciones SQL, y cambios de configuración. Solo investigar, leer y analizar está permitido sin aprobación.
2. **Análisis integral antes de proponer.** Ante cualquier problema o solicitud, hacer primero un análisis profesional, serio y exhaustivo: leer todos los archivos relevantes, entender el flujo completo end-to-end, identificar todas las dependencias y posibles efectos secundarios. Solo después de tener el panorama completo, presentar el diagnóstico y la propuesta a Víctor.
3. **La fuente de verdad es Supabase en tiempo real, NUNCA fuentes secundarias.** Los archivos SQL del repo, la sección de auditoría de este mismo CLAUDE.md, y cualquier dato histórico pueden estar desactualizados. SIEMPRE generar el SQL de verificación y pedir a Víctor que lo ejecute en Supabase antes de asumir conteos, columnas, o estado de las tablas. Ejemplo: antes de hacer un UPDATE, verificar `SELECT count(*) FROM tabla WHERE condicion` — nunca confiar en cifras escritas en documentación.
4. **No adivinar.** Si no se tiene información, preguntar al usuario o generar el SQL necesario para obtenerla de Supabase. Esto aplica especialmente a conteos de filas, existencia de columnas, y estado de índices.
5. **Una cosa a la vez.** No bombardear al usuario con múltiples preguntas o acciones simultáneas.
6. **SQL que funcione.** No usar `DO $$` en Supabase SQL Editor (inyecta comentarios y rompe). Usar queries simples y directas.
7. **No sacar conclusiones precipitadas.** Verificar antes de afirmar.
8. **ANTES de cualquier operación destructiva (DELETE, TRUNCATE, DROP, UPDATE masivo), verificar TODAS las dependencias.** Generar SQL para consultar foreign keys, conteos de filas dependientes, y cualquier referencia antes de proponer el comando. NUNCA dar un TRUNCATE/DELETE sin haber verificado primero qué tablas referencian la tabla objetivo. Ejemplo: antes de truncar una tabla, ejecutar `SELECT conname, confrelid::regclass AS tabla_origen FROM pg_constraint WHERE confrelid = 'nombre_tabla'::regclass AND contype = 'f';` para ver quién depende de ella.

---

## Auditoría de Supabase - 23 febrero 2026

### Fuente de verdad: estado real de la base de datos

Datos obtenidos directamente de Supabase mediante consultas a `information_schema` y `pg_catalog`.

---

### 1. Tablas existentes (16)

| Tabla | Tipo | PK | Descripción |
|-------|------|-----|-------------|
| `projects` | tabla | uuid | Entidad principal. Empresa/trabajo del consultor |
| `knowledge_documents` | tabla | text | RAG General: normativa, BREFs, directivas (Google Drive) |
| `knowledge_chunks` | tabla | text | Chunks + embeddings del RAG General |
| `project_documents` | tabla | text | RAG Proyecto: docs específicos de cada proyecto |
| `project_chunks` | tabla | text | Chunks + embeddings del RAG Proyecto |
| `compliance_alerts` | tabla | uuid | Alertas de cumplimiento normativo |
| `savings_opportunities` | tabla | uuid | Oportunidades de ahorro detectadas |
| `waste_inventory` | tabla | uuid | Inventario de residuos por proyecto |
| `waste_managers` | tabla | uuid | Gestores de residuos autorizados |
| `invoice_lines` | tabla | uuid | Líneas de facturas de gestión |
| `contracts` | tabla | uuid | Contratos con gestores |
| `pipeline_progress` | tabla | text (doc_id) | Progreso en tiempo real del pipeline de ingesta |
| `consultant_gdrive` | tabla | uuid | Tokens OAuth de Google Drive por consultor |
| `gdrive_sync_log` | tabla | uuid | Log de sincronizaciones con Google Drive |
| `knowledge_stats` | vista | - | Estadísticas agregadas del RAG General |
| `project_stats` | vista | - | Estadísticas agregadas del RAG Proyecto |

### 2. Arquitectura de datos

```
projects (uuid)
├── project_documents (text) ──→ project_chunks (text) [RAG Proyecto]
├── compliance_alerts (uuid)
├── savings_opportunities (uuid)
├── invoice_lines (uuid)
├── waste_inventory (uuid)
├── contracts (uuid) ──→ waste_managers (uuid)
└── project_chunks (uuid ref)

knowledge_documents (text) ──→ knowledge_chunks (text) [RAG General]
  (sin proyecto, accesible por todos los autenticados)

consultant_gdrive (uuid) ──→ auth.users
gdrive_sync_log (uuid) ──→ consultant_id (sin FK explícita)
pipeline_progress (text) ──→ sin FK
```

### 3. Foreign keys verificadas

| Tabla origen | Columna | Tabla destino |
|-------------|---------|---------------|
| knowledge_chunks | document_id | knowledge_documents |
| project_chunks | document_id | project_documents |
| project_chunks | project_id | projects |
| project_documents | project_id | projects |
| compliance_alerts | project_id | projects |
| compliance_alerts | doc_id | project_documents |
| savings_opportunities | project_id | projects |
| savings_opportunities | waste_id | waste_inventory |
| invoice_lines | project_id | projects |
| invoice_lines | doc_id | project_documents |
| waste_inventory | project_id | projects |
| waste_inventory | fuente_doc_id | project_documents |
| contracts | project_id | projects |
| contracts | manager_id | waste_managers |

### 4. Políticas RLS

| Tabla | Política | Comando | Lógica |
|-------|----------|---------|--------|
| `projects` | consultant_own_projects | ALL | `consultant_id = auth.uid()` |
| `knowledge_documents` | authenticated_read_knowledge_docs | SELECT | `auth.role() = 'authenticated'` |
| `knowledge_documents` | service_write_knowledge_docs | ALL | `auth.role() = 'service_role'` |
| `knowledge_chunks` | authenticated_read_knowledge_chunks | SELECT | `auth.role() = 'authenticated'` |
| `knowledge_chunks` | service_write_knowledge_chunks | ALL | `auth.role() = 'service_role'` |
| `project_documents` | consultant_own_project_docs | ALL | `project_id IN (projects del consultor)` |
| `project_chunks` | consultant_own_project_chunks | ALL | `project_id IN (projects del consultor)` |
| `compliance_alerts` | user_own_alerts | ALL | `project_id IN (projects del consultor)` |
| `savings_opportunities` | user_own_savings | ALL | `project_id IN (projects del consultor)` |
| `waste_inventory` | user_own_waste_inventory | ALL | `project_id IN (projects del consultor)` |
| `invoice_lines` | user_own_invoice_lines | ALL | `project_id IN (projects del consultor)` |
| `contracts` | user_own_contracts | ALL | `project_id IN (projects del consultor)` |
| `waste_managers` | authenticated_read_managers | SELECT | `auth.role() = 'authenticated'` |
| `consultant_gdrive` | user_own_gdrive | ALL | `consultant_id = auth.uid()` |
| `gdrive_sync_log` | user_own_sync_log | ALL | `consultant_id = auth.uid()` |

**Tablas SIN política RLS:** `pipeline_progress` (no tiene RLS habilitado - cualquiera puede leer/escribir)

### 5. Funciones RAG

Las tres funciones de búsqueda existen y están operativas:
- `search_knowledge` - Búsqueda vectorial en RAG General
- `search_project` - Búsqueda vectorial en RAG Proyecto
- `search_combined` - Búsqueda combinada en ambos RAGs

### 6. Tablas obsoletas eliminadas

Las tablas del esquema antiguo ya NO existen (migración 004 ejecutada correctamente):
- `clients` - eliminada
- `client_documents` - eliminada
- `document_chunks` - eliminada

---

### 7. Hallazgos de la auditoría

#### PROBLEMAS DETECTADOS

**P1: Error PGRST205 en "Base de Conocimiento"**
- **Síntoma:** La página muestra `Could not find the table 'public.knowledge_documents' in the schema cache`
- **Estado real:** La tabla SÍ existe, tiene 33 documentos, RLS está activo, las políticas existen
- **Causa probable:** Cache de PostgREST desactualizado. Se ejecutó `NOTIFY pgrst, 'reload schema'` pero no se ha verificado si el error persiste
- **Acción pendiente:** Verificar si el error sigue apareciendo tras recargar la página

**P2: `pipeline_progress` sin RLS**
- La tabla `pipeline_progress` no tiene Row Level Security habilitado
- Cualquier usuario autenticado puede leer/escribir el progreso de cualquier documento
- **Riesgo:** Bajo (datos no sensibles, solo progreso de pipeline)
- **Recomendación:** Considerar habilitar RLS si se quiere aislar por consultor

**P3: `gdrive_sync_log` sin FK a `auth.users`**
- La columna `consultant_id` no tiene foreign key a `auth.users`
- La política RLS protege los datos, pero no hay integridad referencial
- **Riesgo:** Medio (podrían quedar registros huérfanos si se elimina un usuario)

**P4: `consultant_gdrive` sin FK a `auth.users` en Supabase**
- El script `setup.sql` del repo define `REFERENCES auth.users(id)` pero no aparece en las FK reales
- La política RLS compensa, pero falta integridad referencial

**P5: Discrepancia knowledge_documents vs knowledge_chunks**
- 33 documentos pero solo 9 chunks
- Esto indica que la mayoría de documentos se registraron pero NO se particionaron correctamente
- Los documentos sin chunks no son buscables por RAG

**P6: Archivos SQL del repo desactualizados**
- `schema_legacy_base.sql` referencia tablas `clients` y `client_documents` que ya no existen
- `schema_legacy_scoping.sql` referencia `document_chunks` y `clients` que ya no existen
- `migration_001_complete_schema.sql` referencia tabla `clients` que ya no existe
- `migration_002_google_drive.sql` añade columna a `client_documents` que ya no existe
- Estos archivos son confusos porque no reflejan el estado actual

#### SIN PROBLEMAS

- Estructura de tablas principales correcta y completa
- Foreign keys bien definidas entre todas las tablas de proyecto
- Políticas RLS coherentes: cada consultor solo ve sus datos
- Knowledge base accesible en lectura por todos los autenticados, escritura solo por service_role
- Funciones RAG (search_knowledge, search_project, search_combined) existen
- Vistas de estadísticas (knowledge_stats, project_stats) existen
- Google Drive integration (consultant_gdrive, gdrive_sync_log) bien estructurada

---

### 8. Mapa de uso: qué código toca qué tabla

#### API Routes (Next.js) - todas usan `getAdminClient()` (service_role)

| Ruta API | Tablas | Operaciones |
|----------|--------|-------------|
| `/api/knowledge-base` GET | knowledge_documents | SELECT |
| `/api/knowledge-base/stats` GET | knowledge_documents | SELECT |
| `/api/knowledge-base/health` GET | knowledge_documents, knowledge_chunks, gdrive_sync_log | SELECT |
| `/api/knowledge-base/[docId]` DELETE | knowledge_documents, knowledge_chunks | DELETE |
| `/api/rag` POST | knowledge_chunks o project_chunks, knowledge_documents o project_documents | SELECT |
| `/api/gdrive/status` GET | consultant_gdrive | SELECT |
| `/api/gdrive/callback` GET | consultant_gdrive | UPSERT |
| `/api/gdrive/disconnect` DELETE | consultant_gdrive | DELETE |
| `/api/gdrive/sync-status` GET | consultant_gdrive, gdrive_sync_log | SELECT |
| `/api/gdrive/sync-toggle` POST | consultant_gdrive | UPDATE |

#### Frontend (browser client, anon key)

| Página | Tablas | Operaciones |
|--------|--------|-------------|
| `/dashboard` (SSR) | projects, knowledge_documents, compliance_alerts, savings_opportunities, project_documents | SELECT |

#### Pipeline Python (service_role)

| Módulo | Tablas | Operaciones |
|--------|--------|-------------|
| `api/server.py` | knowledge_documents, knowledge_chunks, consultant_gdrive, gdrive_sync_log | SELECT, UPSERT, UPDATE, DELETE |
| `pipeline/storage.py` | knowledge_documents, knowledge_chunks, project_documents, project_chunks, waste_inventory, invoice_lines, compliance_alerts | UPSERT |
| `pipeline/pdf_pipeline.py` | pipeline_progress | UPSERT |
| `pipeline/rag_scoping.py` | (vía RPC) search_knowledge, search_project | RPC |
| `pipeline/unified_ingestion.py` | knowledge_documents, knowledge_chunks, project_documents, project_chunks, waste_inventory, invoice_lines | UPSERT |

---

### 9. Acciones recomendadas (por prioridad)

1. **Verificar si PGRST205 persiste** - Recargar la página tras el NOTIFY pgrst
2. **Investigar por qué 33 docs pero solo 9 chunks** - Los documentos sin chunks no funcionan en el RAG
3. **Limpiar archivos SQL obsoletos del repo** - Eliminar o marcar como legacy los scripts que referencian tablas eliminadas
4. **Evaluar FK faltantes** en gdrive_sync_log y consultant_gdrive hacia auth.users
5. **Evaluar RLS en pipeline_progress** si se quiere aislar por consultor

---

## Changelog

### 24 febrero 2026

#### Mejora calidad Asesor IA

| Parámetro | Antes | Después |
|-----------|-------|---------|
| System prompt | Instrucciones básicas | + sección de profundidad: exhaustivo, calidad profesional, 500-1000 palabras mínimo, anticipar preguntas de seguimiento |
| Extended thinking budget | 10,000 tokens | 24,000 tokens |
| RAG top_k por scope | 8 | 12 |
| RAG similarity threshold | 0.60 | 0.65 |
| Método de razonamiento | 5 pasos básicos | 7 pasos con análisis de alternativas y recomendaciones |

**Archivos modificados:** `api/server.py` (ADVISOR_SYSTEM_PROMPT, parámetros RAG, thinking budget)

#### Exportar respuestas a Word (.docx)

Nuevo botón "Word" en cada respuesta del asesor que genera un documento .docx con marca Vandarum:
- Header: barra teal con "VANDARUM" + "Informe del Asesor IA"
- Secciones: Consulta, Análisis y Recomendaciones, Fuentes Consultadas
- Conversión de markdown a formato Word (negritas, cursivas, listas, encabezados)
- Footer: "Generado por ResidusIA Pro — vandarum.com"
- Disclaimer legal

**Archivos creados:** `web/src/lib/export-word.ts`
**Archivos modificados:** `web/src/app/dashboard/advisor/page.tsx` (botón Download, import lucide-react)
**Dependencias añadidas:** `docx`, `file-saver`, `@types/file-saver`

#### Google Drive Sync resiliente

**Problema:** El sync de 799 archivos fallaba por HttpError 500 de Google y timeout de 30 min.

**Cambios en `pipeline/google_drive.py`:**

| Función | Antes | Después |
|---------|-------|---------|
| `list_folder()` | Sin retry, falla al primer error | 4 intentos con backoff exponencial (1s, 2s, 4s, 8s) en HTTP 500/502/503/429 |
| `download_file()` | Sin retry | 4 intentos con backoff en metadata y descarga |
| `list_all_files_recursive()` | Recursión profunda, sin pausa, sin logging | BFS iterativo con `deque`, pausa 0.3s entre carpetas, log cada 20 carpetas |

**Cambios en `api/server.py`:**

| Parámetro | Antes | Después |
|-----------|-------|---------|
| Stale sync timeout | 30 minutos | 120 minutos |
| Endpoint `POST /api/gdrive/sync-all` | Existía (cron no configurado) | Eliminado |

---

## Mapa técnico del proyecto

### Endpoints Python (FastAPI — `api/server.py`)

| Método | Ruta | Descripción |
|--------|------|-------------|
| GET | `/health` | Health check |
| POST | `/api/ingest` | Ingestion de documentos (file, URL, storage_path) |
| POST | `/api/rag/query` | Búsqueda RAG + generación de respuesta |
| GET | `/api/rag/health` | Health check del RAG |
| POST | `/api/advisor` | Asesor IA (texto) |
| POST | `/api/advisor/chat` | Asesor IA (multi-turn con adjuntos) |
| POST | `/api/analyze-project` | Análisis multi-agente de proyecto |
| GET | `/api/knowledge-base` | Listar documentos KB |
| GET | `/api/knowledge-base/stats` | Estadísticas KB |
| DELETE | `/api/knowledge-base/{doc_id}` | Eliminar documento KB |
| POST | `/api/knowledge-base/reprocess` | Reprocesar documentos KB |
| GET | `/api/gdrive/auth-url` | URL OAuth Google Drive |
| POST | `/api/gdrive/exchange` | Intercambiar código OAuth |
| GET | `/api/gdrive/picker-token` | Token para Google Picker |
| POST | `/api/gdrive/setup-folders` | Crear estructura carpetas en Drive |
| GET | `/api/gdrive/status` | Estado conexión Drive |
| GET | `/api/gdrive/browse` | Navegar archivos/carpetas Drive |
| POST | `/api/gdrive/ingest-file` | Ingestar archivo individual de Drive |
| POST | `/api/gdrive/sync` | Sincronizar carpeta completa de Drive |
| GET | `/api/gdrive/sync-status` | Estado/historial sync |
| POST | `/api/gdrive/sync-toggle` | Activar/desactivar auto-sync |
| DELETE | `/api/gdrive/disconnect` | Desconectar Google Drive |

### API Routes Next.js (`web/src/app/api/`)

Todas actúan como proxy al backend Python, usando `getAdminClient()` (service_role).

| Ruta | Método | Proxy a |
|------|--------|---------|
| `/api/knowledge-base` | GET | Supabase directo |
| `/api/knowledge-base/[docId]` | DELETE | Supabase directo |
| `/api/knowledge-base/stats` | GET | Supabase directo |
| `/api/knowledge-base/health` | GET | Supabase directo |
| `/api/knowledge-base/reprocess` | POST | Python `/api/knowledge-base/reprocess` |
| `/api/rag` | POST | Supabase RPC (search_knowledge, search_project) |
| `/api/rag/health` | GET | Python `/api/rag/health` |
| `/api/ingest` | POST | Python `/api/ingest` |
| `/api/upload-signed-url` | POST | Supabase Storage (signed URL) |
| `/api/advisor` | POST | Python `/api/advisor` |
| `/api/advisor/chat` | POST | Python `/api/advisor/chat` |
| `/api/analyze-project` | POST | Python `/api/analyze-project` |
| `/api/gdrive/auth-url` | GET | Python `/api/gdrive/auth-url` |
| `/api/gdrive/callback` | GET | Python `/api/gdrive/exchange` |
| `/api/gdrive/status` | GET | Python `/api/gdrive/status` |
| `/api/gdrive/picker-token` | GET | Python `/api/gdrive/picker-token` |
| `/api/gdrive/browse` | GET | Python `/api/gdrive/browse` |
| `/api/gdrive/setup-folders` | POST | Python `/api/gdrive/setup-folders` |
| `/api/gdrive/ingest-file` | POST | Python `/api/gdrive/ingest-file` |
| `/api/gdrive/sync` | POST | Python `/api/gdrive/sync` |
| `/api/gdrive/sync-status` | GET | Python `/api/gdrive/sync-status` |
| `/api/gdrive/sync-toggle` | POST | Python `/api/gdrive/sync-toggle` |
| `/api/gdrive/disconnect` | DELETE | Python `/api/gdrive/disconnect` |
| `/api/projects/[projectId]/documents/[docId]` | DELETE | Supabase directo |

### Páginas Frontend (`web/src/app/`)

| Ruta | Descripción |
|------|-------------|
| `/` | Landing page pública |
| `/login` | Login (email/password) |
| `/register` | Registro de usuario |
| `/dashboard` | Dashboard: KPIs, alertas urgentes, documentos recientes |
| `/dashboard/advisor` | Asesor IA: chat multi-turn + adjuntos + exportar Word |
| `/dashboard/knowledge-base` | Base de Conocimiento: docs normativos, Drive sync, navegador |
| `/dashboard/projects` | Lista de proyectos con búsqueda/filtro |
| `/dashboard/projects/new` | Crear nuevo proyecto |
| `/dashboard/projects/[id]` | Detalle proyecto: 7 tabs (resumen, docs, inventario, contratos, alertas, ahorros, análisis IA) |
| `/dashboard/projects/[id]/upload` | Subir documentos al proyecto |
| `/dashboard/settings` | Ajustes: perfil, Google Drive, carpeta raíz |

### Pipeline de Procesamiento (`pipeline/`)

| Módulo | Función |
|--------|---------|
| `unified_ingestion.py` | Punto de entrada: detecta formato → enruta al procesador |
| `pdf_pipeline.py` | PDFs: digital, escaneado (OCR via Claude vision), híbrido, encriptado |
| `excel_processor.py` | Excel/CSV: extracción de tablas |
| `text_processor.py` | DOCX/TXT/HTML: extracción de texto |
| `classifier_chunker.py` | Clasificación de tipo doc + chunking semántico |
| `metadata_extractor.py` | Extracción: códigos LER, fechas, precios, gestores |
| `storage.py` | Persistencia: Supabase DB (docs + chunks) + Storage (archivos) |
| `rag_scoping.py` | RAG dual: búsqueda semántica en General y/o Proyecto |
| `config.py` | Config: API keys, EmbeddingService (OpenAI) |
| `google_drive.py` | Google Drive: OAuth, listado BFS con retry, descarga con retry, sync |

### Agentes LangGraph (`pipeline/agents/`)

Ejecución paralela de 5 agentes analistas + 1 optimizador + 1 redactor:

| Agente | Qué analiza | Tipos de hallazgo |
|--------|-------------|-------------------|
| `agent_aai.py` | Autorización Ambiental Integrada | ler_no_autorizado, limite_excedido, condicion_incumplida |
| `agent_contratos.py` | Contratos con gestores | contrato_vencido, precio_alto, sin_contrato, gestor_no_autorizado |
| `agent_facturas.py` | Facturas de gestión | price_anomaly, quantity_mismatch, trend_alert |
| `agent_registro.py` | Registro producción/cronológico | Consistencia LER, entradas faltantes |
| `agent_normativo.py` | Cumplimiento normativo | Riesgos vs Ley 7/2022, RD 553/2020, Directiva 2008/98/CE |
| `agent_optimizador.py` | Priorización | Severidad + ROI, deduplicación |
| `agent_redactor.py` | Informe final | Resumen ejecutivo + secciones detalladas |

### Flujo de sincronización Google Drive

```
1. Consultor conecta Drive (OAuth2) → consultant_gdrive
2. Auto-sync: cada 6h si página KB abierta y auto_sync_enabled=true
   └─ O manual: botón "Sincronizar ahora"
3. POST /api/gdrive/sync → crea gdrive_sync_log (status=running)
4. Background task (_run_sync_job):
   a. BFS iterativo de carpetas (con retry + pausa 0.3s entre carpetas)
   b. Deduplicación: consulta drive_file_id en knowledge_documents
   c. Para cada archivo nuevo:
      ├─ download_file() con retry
      ├─ service.ingest() con timeout 5min
      └─ Actualizar progreso en gdrive_sync_log
   d. Final: status=completed + conteos
5. Stale sync: si lleva >120 min running → marcar como error
```
