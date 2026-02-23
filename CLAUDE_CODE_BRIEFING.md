# BRIEFING — ResidusIA Pro
# Actualizado: 23 febrero 2026 — Verificado contra Supabase real

## TU ROL

Ingeniero principal de **ResidusIA Pro**, plataforma SaaS de consultoría ambiental
especializada en gestión de residuos industriales en España y Europa.

El usuario es un consultor experto que:
- Gestiona 10-50 clientes industriales
- Maneja documentación regulatoria (AAI, contratos, facturas, registros)
- Necesita reducir costes manteniendo cumplimiento legal
- Quiere escalar con IA agéntica

**Principio rector**: La normativa es el suelo mínimo. Dentro de ese suelo, minimizar costes.

---

## ARQUITECTURA

```
Frontend (Next.js 14 + Tailwind + shadcn/ui) → Vercel
    │
    ▼
Supabase (PostgreSQL + pgvector + Auth + Storage + Realtime)
    │
    ▼
Pipeline Python (FastAPI) → Railway/Fly.io
    │
    ▼
Agentes IA (LangGraph) → próxima fase
```

---

## MODELO DE DATOS (verificado contra Supabase real)

> **La fuente de verdad es Supabase, no estos archivos.**

### Entidad principal: `projects` (no existe tabla `clients`)

Cada proyecto ES un cliente/trabajo del consultor.

Columnas: id (uuid PK), consultant_id, nombre, cif, cnae, sector,
comunidad_autonoma, municipio, direccion, contacto_nombre, contacto_email,
contacto_telefono, notas, tipo, estado, descripcion, fecha_inicio, fecha_fin,
metadata (jsonb), created_at, updated_at.

### RAG General (normativa, BREFs, directivas — accesible por todos)

- `knowledge_documents` (id TEXT PK, titulo, tipo, estado, drive_file_id...)
- `knowledge_chunks` (id TEXT PK, document_id FK → knowledge_documents, embedding VECTOR(1536)...)

### RAG Proyecto (docs específicos de cada proyecto — privado)

- `project_documents` (id TEXT PK, project_id FK → projects, titulo, tipo, estado...)
- `project_chunks` (id TEXT PK, document_id FK → project_documents, project_id FK → projects, embedding...)

### Tablas de negocio (todas con project_id FK → projects)

- `waste_inventory` — inventario de residuos
- `invoice_lines` — líneas de facturas
- `compliance_alerts` — alertas de cumplimiento
- `savings_opportunities` — oportunidades de ahorro (waste_id FK → waste_inventory)
- `contracts` — contratos con gestores (manager_id FK → waste_managers)
- `waste_managers` — gestores autorizados (lectura para todos)

### Infraestructura

- `consultant_gdrive` — tokens OAuth Google Drive por consultor
- `gdrive_sync_log` — log de sincronizaciones
- `pipeline_progress` — progreso en tiempo real del pipeline

### Vistas

- `knowledge_stats`, `project_stats`

### Funciones RAG

- `search_knowledge(query_embedding, doc_type_filter, match_threshold, match_count)`
- `search_project(query_embedding, p_project_id, doc_type_filter, match_threshold, match_count)`
- `search_combined(query_embedding, p_project_id, doc_type_filter, match_threshold, match_count_kb, match_count_project)`

### RLS

- projects: consultant_id = auth.uid()
- knowledge_*: SELECT para authenticated, ALL para service_role
- project_*: solo consultor dueño del proyecto
- Tablas negocio: solo consultor dueño del proyecto
- waste_managers: lectura para todos
- consultant_gdrive, gdrive_sync_log: solo consultor dueño

---

## SISTEMA RAG EN DOS CAPAS

```
RAG GENERAL → knowledge_documents + knowledge_chunks
  Normativa, BREFs, guías. Lectura para todos. Función: search_knowledge()

RAG PROYECTO → project_documents + project_chunks
  AAI, contratos, facturas. Solo consultor dueño. Función: search_project()

COMBINADO → search_combined() devuelve resultados etiquetados con source
```

Routing automático: legislacion/documentacion_tecnica → knowledge. Todo lo demás → project.

---

## PIPELINE

```
Archivo → UnifiedIngestionService.ingest()
  ├── PDF → PDFPipeline (detección, extracción, clasificación, chunking, embeddings, metadatos)
  ├── Excel → ExcelProcessor (hojas, chunks, poblar waste_inventory + invoice_lines)
  └── DOCX/TXT → TextProcessor (chunks, embeddings)
  → Routing automático → knowledge_documents O project_documents
```

---

## AGENTES IA (LangGraph — PRÓXIMA FASE)

```
classify_docs → [AgenteAAI, AgenteContratos, AgenteFacturas, AgenteRegistro]
AgenteAAI → AgenteNormativo
[todos] → AgenteOptimizador → AgenteRedactor
```

---

## CONTEXTO DE NEGOCIO

- Códigos LER: 6 dígitos, peligrosos con asterisco
- Operaciones: D1-D15 (eliminación), R1-R13 (valorización). Ley obliga R sobre D.
- Marco legal: Ley 7/2022, Directiva 2008/98/CE, RDL 1/2016, normativa autonómica
- DARI: declaración anual obligatoria

---

## DECISIONES DE DISEÑO

1. No hay tabla `clients`. `projects` es la entidad principal.
2. Un solo punto de entrada de ingesta (`unified_ingestion.py`).
3. RAG scope automático por tipo de documento.
4. Tablas separadas para cada RAG (no un campo `rag_scope`).
5. Metadatos en JSONB y en tablas estructuradas.
6. Contexto RAG etiquetado por source.
7. LangGraph para agentes.
8. Claude Haiku para clasificación, Claude Sonnet para análisis.
