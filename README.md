# ResidusIA Pro

Plataforma SaaS de consultoría ambiental para gestión de residuos industriales.

## Componentes

| Componente | Tecnología | Ubicación |
|---|---|---|
| Frontend | Next.js 14 + Tailwind + shadcn/ui | `web/` |
| Pipeline | Python FastAPI | `api/` + `pipeline/` |
| Base de datos | Supabase (PostgreSQL + pgvector) | `supabase/` |

## Estructura

```
├── api/server.py              ← FastAPI endpoints
├── pipeline/                  ← procesamiento de documentos
│   ├── pdf_pipeline.py        ← PDFs (OCR, tablas, encriptados)
│   ├── excel_processor.py     ← Excel/CSV
│   ├── text_processor.py      ← DOCX/TXT/HTML
│   ├── storage.py             ← Supabase Storage + PostgreSQL
│   ├── rag_scoping.py         ← búsqueda RAG dual
│   ├── unified_ingestion.py   ← punto de entrada único
│   └── agents/                ← análisis multi-agente (LangGraph)
│       ├── graph.py           ← grafo dirigido + progreso vía Supabase Realtime
│       ├── agent_*.py         ← agentes especializados (aai, contratos, facturas, etc.)
│       └── state.py           ← estado compartido del grafo
├── supabase/
│   ├── setup.sql              ← esquema base
│   └── verify_data.sql        ← queries de diagnóstico
└── web/                       ← Next.js frontend
```

## Base de datos

Dos RAGs separados:
- **knowledge_documents/chunks** — normativa, BREFs (accesible por todos)
- **project_documents/chunks** — docs de cada proyecto (privado por consultor)

Tablas de negocio: waste_inventory, invoice_lines, compliance_alerts,
savings_opportunities, contracts, waste_managers.

Progreso en tiempo real vía Supabase Realtime:
- **pipeline_progress** — progreso de ingesta de documentos
- **analysis_progress** — progreso del análisis multi-agente

Ver `CLAUDE.md` para la auditoría completa.

## Setup

### Frontend
```bash
cd web && npm install && cp .env.local.example .env.local
# Rellenar variables de Supabase
npm run dev
```

### Pipeline
```bash
pip install -r requirements.txt && cp .env.example .env
# Rellenar variables (Supabase, OpenAI, Anthropic, Google)
python -m api.server
```

### Supabase
Ejecutar `supabase/setup.sql` en el SQL Editor de Supabase.

## Variables de entorno

```
NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY
ANTHROPIC_API_KEY, OPENAI_API_KEY
GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET
PIPELINE_API_URL, FRONTEND_URL
```
