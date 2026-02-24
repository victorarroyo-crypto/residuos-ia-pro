# CLAUDE.md - ResidusIA Pro

## Reglas de comportamiento (OBLIGATORIAS)

1. **NUNCA implementar sin aprobación de Víctor.** Antes de escribir o modificar cualquier archivo de código, presentar el plan completo y esperar aprobación explícita. Esto incluye: nuevos archivos, ediciones de archivos existentes, migraciones SQL, y cambios de configuración. Solo investigar, leer y analizar está permitido sin aprobación.
2. **Análisis integral antes de proponer.** Ante cualquier problema o solicitud, hacer primero un análisis profesional, serio y exhaustivo: leer todos los archivos relevantes, entender el flujo completo end-to-end, identificar todas las dependencias y posibles efectos secundarios. Solo después de tener el panorama completo, presentar el diagnóstico y la propuesta a Víctor.
3. **La fuente de verdad es Supabase, no los archivos SQL del repo.** Los archivos en `supabase/` son scripts históricos. Pueden no coincidir con lo que hay desplegado. Antes de actuar, verificar el estado real consultando la base de datos.
4. **No adivinar.** Si no se tiene información, preguntar al usuario o generar el SQL necesario para obtenerla de Supabase.
5. **Una cosa a la vez.** No bombardear al usuario con múltiples preguntas o acciones simultáneas.
6. **SQL que funcione.** No usar `DO $$` en Supabase SQL Editor (inyecta comentarios y rompe). Usar queries simples y directas.
7. **No sacar conclusiones precipitadas.** Verificar antes de afirmar.

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
