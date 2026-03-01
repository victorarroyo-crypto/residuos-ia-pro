# CLAUDE.md - ResidusIA Pro

## Reglas de comportamiento (OBLIGATORIAS)

1. **NUNCA implementar sin aprobacion de Victor.** Antes de escribir o modificar cualquier archivo de codigo, presentar el plan completo y esperar aprobacion explicita. Esto incluye: nuevos archivos, ediciones de archivos existentes, migraciones SQL, y cambios de configuracion. Solo investigar, leer y analizar esta permitido sin aprobacion.
2. **Analisis integral antes de proponer.** Ante cualquier problema o solicitud, hacer primero un analisis profesional, serio y exhaustivo: leer todos los archivos relevantes, entender el flujo completo end-to-end, identificar todas las dependencias y posibles efectos secundarios. Solo despues de tener el panorama completo, presentar el diagnostico y la propuesta a Victor.
3. **La fuente de verdad es Supabase en tiempo real, NUNCA fuentes secundarias.** Los archivos SQL del repo, la seccion de auditoria de este mismo CLAUDE.md, y cualquier dato historico pueden estar desactualizados. SIEMPRE generar el SQL de verificacion y pedir a Victor que lo ejecute en Supabase antes de asumir conteos, columnas, o estado de las tablas. Ejemplo: antes de hacer un UPDATE, verificar `SELECT count(*) FROM tabla WHERE condicion` — nunca confiar en cifras escritas en documentacion.
4. **No adivinar.** Si no se tiene informacion, preguntar al usuario o generar el SQL necesario para obtenerla de Supabase. Esto aplica especialmente a conteos de filas, existencia de columnas, y estado de indices.
5. **Una cosa a la vez.** No bombardear al usuario con multiples preguntas o acciones simultaneas.
6. **SQL que funcione.** No usar `DO $$` en Supabase SQL Editor (inyecta comentarios y rompe). Usar queries simples y directas.
7. **No sacar conclusiones precipitadas.** Verificar antes de afirmar.
8. **ANTES de cualquier operacion destructiva (DELETE, TRUNCATE, DROP, UPDATE masivo), verificar TODAS las dependencias.** Generar SQL para consultar foreign keys, conteos de filas dependientes, y cualquier referencia antes de proponer el comando. NUNCA dar un TRUNCATE/DELETE sin haber verificado primero que tablas referencian la tabla objetivo. Ejemplo: antes de truncar una tabla, ejecutar `SELECT conname, confrelid::regclass AS tabla_origen FROM pg_constraint WHERE confrelid = 'nombre_tabla'::regclass AND contype = 'f';` para ver quien depende de ella.

---

## Resumen del proyecto

**ResidusIA Pro** es una plataforma SaaS para consultores ambientales especializados en gestion de residuos industriales en Espana. Combina:

- **RAG dual** (General + Proyecto) para busqueda semantica en normativa ambiental y documentos de proyecto
- **Asesor IA** multi-proveedor (Claude, GPT, Gemini) con extended thinking y tier PRO+
- **Analisis multi-agente** (LangGraph) con 7 agentes especializados + flujo HITL (Human-in-the-Loop)
- **Model Router** con fallback chain multi-proveedor + CostGuard (circuit breaker de costes)
- **Pipeline de ingestion** que procesa PDF (digital/OCR/hibrido), Excel, CSV, DOCX, TXT, HTML
- **Integracion Google Drive** con OAuth2, sync automatico y navegador de archivos
- **Exportacion profesional** a Word (.docx) con marca Vandarum

Cada consultor solo ve sus propios proyectos y datos (RLS por `consultant_id`).

---

## Stack tecnologico

| Capa | Tecnologia | Version |
|------|-----------|---------|
| **Frontend** | Next.js (App Router) | 14.2.35 |
| **UI** | React + Tailwind CSS + shadcn/ui | React 18, TW 3.4 |
| **Backend API** | FastAPI + Uvicorn | 0.115.0 |
| **Base de datos** | Supabase (PostgreSQL + Auth + Storage + Realtime) | supabase-js 2.97 |
| **IA - LLM (Anthropic)** | Claude Opus 4.6, Sonnet 4, Haiku 4.5 | anthropic >=0.49.0 |
| **IA - LLM (OpenAI)** | GPT-5.2, GPT-5, o3, o4-mini, GPT-5 Mini | openai 1.45.0 |
| **IA - LLM (Google)** | Gemini 2.5 Pro, Gemini 2.5 Flash | google-genai |
| **IA - Embeddings** | OpenAI text-embedding-3-large | openai 1.45.0 |
| **IA - Model Router** | Fallback chain multi-proveedor + CostGuard | custom |
| **IA - Agentes** | LangGraph (multi-agente paralelo) | 0.2.76 |
| **OCR** | Tesseract + Claude Vision (escaneados) | pytesseract 0.3.13 |
| **PDF** | pdfplumber + pdf2image + pikepdf | 0.11.0 |
| **Google Drive** | Google Drive API v3 + OAuth2 | 2.108.0 |
| **Deployment backend** | Railway (Docker) | Python 3.11-slim |
| **Deployment frontend** | Vercel (CDG1 - Paris) | - |
| **Observabilidad** | LangSmith (opcional) | - |

---

## Estructura del repositorio

```
residuos-ia-pro/
├── CLAUDE.md                    # Este archivo — instrucciones para IA
├── README.md                    # Documentacion publica del proyecto
├── Dockerfile                   # Build del backend Python (Railway)
├── Procfile                     # Entrypoint para Railway/Heroku
├── railway.json                 # Config de deployment Railway
├── requirements.txt             # Dependencias Python
├── .env.example                 # Variables de entorno (backend)
├── .dockerignore
├── .gitignore
├── .vercelignore
│
├── api/
│   └── server.py                # FastAPI — todos los endpoints del backend
│
├── pipeline/                    # Pipeline de procesamiento de documentos
│   ├── __init__.py
│   ├── config.py                # Config: API keys, EmbeddingService (OpenAI)
│   ├── unified_ingestion.py     # Punto de entrada: detecta formato → enruta
│   ├── pdf_pipeline.py          # PDF: digital, escaneado (OCR), hibrido, encriptado
│   ├── excel_processor.py       # Excel/CSV: extraccion de tablas
│   ├── text_processor.py        # DOCX/TXT/HTML: extraccion de texto
│   ├── extractor.py             # Extraccion general de contenido
│   ├── classifier_chunker.py    # Clasificacion de tipo doc + chunking semantico
│   ├── metadata_extractor.py    # Extraccion: codigos LER, fechas, precios, gestores
│   ├── storage.py               # Persistencia: Supabase DB + Storage
│   ├── rag_scoping.py           # RAG dual: busqueda semantica General y/o Proyecto
│   ├── google_drive.py          # Google Drive: OAuth, BFS con retry, sync
│   ├── model_router.py          # ModelRouter: enrutamiento multi-proveedor con fallback chain
│   ├── cost_guard.py            # CostGuard: circuit breaker de costes por proveedor
│   └── agents/                  # Agentes LangGraph para analisis multi-agente
│       ├── __init__.py
│       ├── graph.py             # Grafo LangGraph: orquestacion del flujo
│       ├── state.py             # Definicion del estado compartido entre agentes
│       ├── llm.py               # Wrapper LLM multi-proveedor para agentes (usa ModelRouter)
│       ├── prompts.py           # Templates de prompts para cada agente
│       ├── loader.py            # Carga de documentos del proyecto para analisis
│       ├── tools.py             # Herramientas disponibles para los agentes
│       ├── agent_coordinador.py # Coordinador: orquesta flujo de analisis
│       ├── agent_aai.py         # Analista: Autorizacion Ambiental Integrada
│       ├── agent_contratos.py   # Analista: Contratos con gestores
│       ├── agent_facturas.py    # Analista: Facturas de gestion
│       ├── agent_registro.py    # Analista: Registro de produccion
│       ├── agent_normativo.py   # Analista: Cumplimiento normativo
│       ├── agent_optimizador.py # Optimizador: priorizacion + deduplicacion
│       └── agent_redactor.py    # Redactor: informe final
│
├── supabase/
│   ├── setup.sql                # Esquema base (DDL de tablas, indices, funciones)
│   ├── cost_tracking.sql        # Tablas de cost tracking (api_usage_log, limits, model_config)
│   └── verify_data.sql          # Queries de diagnostico
│
├── brand/                       # Assets de marca Vandarum
│   ├── Logo transparente.png
│   ├── Manual da Marca - Vandarum.pdf
│   └── vandarum *.png           # Variantes del logo (monocromatico, negativo, etc.)
│
└── web/                         # Frontend Next.js
    ├── package.json             # Dependencias + scripts (dev, build, start, lint)
    ├── next.config.mjs          # Config Next.js (images: Supabase Storage, body 4mb)
    ├── tailwind.config.ts       # Tailwind con colores Vandarum (#307177, #32b4cd, etc.)
    ├── tsconfig.json            # TypeScript con alias @/* → ./src/*
    ├── vercel.json              # Config Vercel (timeouts, headers seguridad, region CDG1)
    ├── components.json          # Config shadcn/ui (New York style, RSC)
    ├── .env.local.example       # Variables de entorno frontend
    └── src/
        ├── middleware.ts        # Refresh sesion Supabase en cada request
        ├── app/
        │   ├── layout.tsx       # Root layout (fuente Geist)
        │   ├── globals.css      # Variables CSS + estilos Tailwind
        │   ├── page.tsx         # Landing page publica
        │   ├── login/page.tsx
        │   ├── register/page.tsx
        │   ├── auth/callback/route.ts  # OAuth callback Supabase
        │   ├── dashboard/
        │   │   ├── layout.tsx          # Layout con sidebar
        │   │   ├── page.tsx            # KPIs, alertas, docs recientes
        │   │   ├── advisor/page.tsx    # Chat IA multi-turn + adjuntos + Word
        │   │   ├── knowledge-base/page.tsx  # KB + Drive sync + navegador
        │   │   ├── projects/page.tsx   # Lista proyectos con busqueda
        │   │   ├── projects/new/page.tsx    # Crear proyecto
        │   │   ├── projects/[id]/page.tsx   # Detalle: 7 tabs
        │   │   ├── projects/[id]/upload/page.tsx  # Subir docs
        │   │   └── settings/page.tsx   # Perfil + Google Drive
        │   └── api/                    # API routes (proxy a Python o Supabase directo)
        │       ├── advisor/            # route.ts, chat/route.ts, stream/route.ts
        │       ├── analyze-project/    # route.ts, plan/, execute/, round2/, session/
        │       ├── gdrive/             # 10 rutas (auth, browse, sync, etc.)
        │       ├── knowledge-base/     # route.ts, [docId]/, stats/, health/, reprocess/
        │       ├── rag/                # route.ts, health/
        │       ├── ingest/route.ts
        │       ├── upload-signed-url/route.ts
        │       └── projects/[projectId]/documents/[docId]/route.ts
        ├── components/
        │   ├── advisor-chat.tsx            # Chat UI: mensajes, markdown, adjuntos, export Word
        │   ├── analysis-plan-review.tsx    # HITL: revision/aprobacion de plan de analisis
        │   ├── analysis-progress.tsx       # Barras de progreso en tiempo real (Realtime)
        │   ├── analysis-round2.tsx         # HITL: seguimiento ronda 2
        │   ├── google-drive-picker.tsx     # Navegador de archivos Drive con breadcrumbs
        │   ├── model-selector.tsx          # Selector de modelo LLM (standard/PRO+)
        │   ├── usage-dashboard.tsx         # Dashboard de uso y costes por proveedor
        │   ├── sidebar.tsx                 # Navegacion principal + logout
        │   └── ui/                         # Componentes shadcn/ui
        │       ├── badge.tsx, button.tsx, card.tsx, progress.tsx, table.tsx
        ├── lib/
        │   ├── env.ts                  # loadEnv() con fallback .env.local → .env
        │   ├── export-word.ts          # Generacion .docx con marca Vandarum
        │   ├── render-markdown.ts      # Markdown → HTML con tablas Tailwind
        │   ├── upload.ts               # Upload dual: base64 (<4MB) / signed URL (>4MB)
        │   ├── utils.ts                # cn() para class merging
        │   ├── vandarum-logo-data.ts   # Logo base64 para exportacion Word
        │   ├── supabase.ts             # Export principal Supabase
        │   └── supabase/
        │       ├── admin.ts            # getAdminClient() — service_role
        │       ├── server.ts           # SSR server client con cookies
        │       ├── client.ts           # Browser client
        │       └── middleware.ts        # updateSession() para refresh
        └── types/
            └── database.ts             # 85+ interfaces TypeScript para todas las tablas
```

---

## Configuracion de desarrollo

### Requisitos previos

- **Node.js** 20+ y npm
- **Python** 3.11+
- **Tesseract OCR** con paquetes `spa` y `eng`
- **Poppler** (`poppler-utils` para pdf2image)
- Cuenta en **Supabase**, **Anthropic**, **OpenAI**, **Google Cloud** (Drive API + Picker API)

### Backend (Python/FastAPI)

```bash
# Desde la raiz del repo
cp .env.example .env              # Configurar variables
pip install -r requirements.txt   # Instalar dependencias
python -m api.server              # Arranca en http://localhost:8000
```

### Frontend (Next.js)

```bash
cd web/
cp .env.local.example .env.local  # Configurar variables
npm install                       # Instalar dependencias
npm run dev                       # Arranca en http://localhost:3000
```

### Variables de entorno

**Backend (`.env` en raiz):**

| Variable | Descripcion |
|----------|-------------|
| `NEXT_PUBLIC_SUPABASE_URL` | URL del proyecto Supabase |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Clave publica/anon de Supabase |
| `SUPABASE_SERVICE_ROLE_KEY` | Clave service_role (solo backend) |
| `ANTHROPIC_API_KEY` | API key de Anthropic (Claude) |
| `OPENAI_API_KEY` | API key de OpenAI (embeddings + LLM fallback) |
| `GEMINI_API_KEY` | API key de Google Gemini (LLM fallback, opcional) |
| `PIPELINE_API_URL` | URL del backend FastAPI |
| `FRONTEND_URL` | URL del frontend (para CORS) |
| `GOOGLE_CLIENT_ID` | OAuth2 Client ID de Google |
| `GOOGLE_CLIENT_SECRET` | OAuth2 Client Secret de Google |
| `LANGCHAIN_TRACING_V2` | `true` para habilitar LangSmith (opcional) |
| `LANGCHAIN_PROJECT` | Nombre del proyecto en LangSmith |
| `LANGSMITH_API_KEY` | API key de LangSmith |

**Frontend (`web/.env.local`):**

| Variable | Descripcion |
|----------|-------------|
| `NEXT_PUBLIC_SUPABASE_URL` | URL del proyecto Supabase |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Clave publica/anon de Supabase |
| `PIPELINE_API_URL` | URL del backend FastAPI |

### Scripts disponibles

| Comando | Directorio | Accion |
|---------|-----------|--------|
| `npm run dev` | `web/` | Servidor Next.js en modo desarrollo |
| `npm run build` | `web/` | Build de produccion |
| `npm run lint` | `web/` | ESLint |
| `python -m api.server` | raiz | Servidor FastAPI en puerto 8000 |

---

## Arquitectura de deployment

```
                    ┌─────────────────────────────┐
                    │         Usuario              │
                    └──────────┬──────────────────-┘
                               │
                    ┌──────────▼──────────────────-┐
                    │    Vercel (CDG1 - Paris)      │
                    │    Next.js 14 (Frontend)      │
                    │    ─────────────────────      │
                    │    Timeouts:                  │
                    │    - advisor: 120s            │
                    │    - stream: 300s             │
                    │    - ingest: 120s             │
                    │    Headers: nosniff, DENY,    │
                    │    XSS, strict-referrer       │
                    └──────────┬──────────────────-┘
                               │ API proxy
                    ┌──────────▼──────────────────-┐
                    │    Railway (Docker)           │
                    │    Python 3.11-slim (Backend) │
                    │    ─────────────────────      │
                    │    FastAPI + Uvicorn          │
                    │    Health: /health            │
                    │    Restart: ON_FAILURE (x10)  │
                    │    + Tesseract OCR (spa/eng)  │
                    │    + Poppler (pdf2image)      │
                    └──────────┬──────────────────-┘
                               │
              ┌────────────────┼────────────────┐
              │                │                │
    ┌─────────▼──────┐ ┌──────▼───────┐ ┌──────▼──────┐
    │   Supabase     │ │  ModelRouter │ │   OpenAI    │
    │   PostgreSQL   │ │  + CostGuard │ │  Embeddings │
    │   Auth + RLS   │ │  ──────────  │ │  3-large    │
    │   Storage      │ │  Anthropic   │ │             │
    │   Realtime     │ │  OpenAI      │ └─────────────┘
    │   CostTracking │ │  Google      │
    └────────────────┘ └──────────────┘
```

---

## Mapa tecnico del proyecto

### Endpoints Python (FastAPI — `api/server.py`)

| Metodo | Ruta | Descripcion |
|--------|------|-------------|
| GET | `/health` | Health check |
| POST | `/api/ingest` | Ingestion de documentos (file, URL, storage_path) |
| POST | `/api/rag/query` | Busqueda RAG + generacion de respuesta |
| GET | `/api/rag/health` | Health check del RAG |
| POST | `/api/advisor` | Asesor IA (texto, single-turn) |
| POST | `/api/advisor/chat` | Asesor IA (multi-turn con adjuntos) |
| POST | `/api/advisor/stream` | Asesor IA (SSE streaming con keepalive) |
| POST | `/api/analyze-project` | Analisis multi-agente de proyecto |
| GET | `/api/knowledge-base` | Listar documentos KB |
| GET | `/api/knowledge-base/stats` | Estadisticas KB |
| DELETE | `/api/knowledge-base/{doc_id}` | Eliminar documento KB |
| POST | `/api/knowledge-base/reprocess` | Reprocesar documentos KB |
| GET | `/api/gdrive/auth-url` | URL OAuth Google Drive |
| POST | `/api/gdrive/exchange` | Intercambiar codigo OAuth |
| GET | `/api/gdrive/picker-token` | Token para Google Picker |
| POST | `/api/gdrive/setup-folders` | Crear estructura carpetas en Drive |
| GET | `/api/gdrive/status` | Estado conexion Drive |
| GET | `/api/gdrive/browse` | Navegar archivos/carpetas Drive |
| POST | `/api/gdrive/ingest-file` | Ingestar archivo individual de Drive |
| POST | `/api/gdrive/sync` | Sincronizar carpeta completa de Drive |
| GET | `/api/gdrive/sync-status` | Estado/historial sync |
| POST | `/api/gdrive/sync-toggle` | Activar/desactivar auto-sync |
| DELETE | `/api/gdrive/disconnect` | Desconectar Google Drive |
| GET | `/api/usage-stats` | Estadisticas de uso y costes (dashboard) |
| GET | `/api/cost-limits` | Obtener limites de coste del consultor |
| PUT | `/api/cost-limits` | Actualizar limites de coste |
| GET | `/api/model-config` | Obtener config de modelo por servicio |
| PUT | `/api/model-config` | Actualizar config de modelo |
| GET | `/api/available-models` | Listar modelos disponibles con capacidades |

### API Routes Next.js (`web/src/app/api/`)

Todas actuan como proxy al backend Python o acceden a Supabase directamente, usando `getAdminClient()` (service_role).

| Ruta | Metodo | Proxy a |
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
| `/api/advisor/stream` | POST | Python `/api/advisor/stream` (SSE, 300s timeout) |
| `/api/analyze-project` | POST | Python `/api/analyze-project` |
| `/api/analyze-project/plan` | POST | Python — obtener plan de analisis para revision HITL |
| `/api/analyze-project/execute` | POST | Python — ejecutar plan aprobado |
| `/api/analyze-project/round2` | POST | Python — ronda 2 con feedback del consultor |
| `/api/analyze-project/session` | POST | Python — listar sesiones de analisis |
| `/api/analyze-project/session/[id]` | GET | Python — obtener estado de sesion |
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

### Paginas Frontend (`web/src/app/`)

| Ruta | Descripcion |
|------|-------------|
| `/` | Landing page publica |
| `/login` | Login (email/password) |
| `/register` | Registro de usuario |
| `/dashboard` | Dashboard: KPIs, alertas urgentes, documentos recientes |
| `/dashboard/advisor` | Asesor IA: chat multi-turn + adjuntos + exportar Word |
| `/dashboard/knowledge-base` | Base de Conocimiento: docs normativos, Drive sync, navegador |
| `/dashboard/projects` | Lista de proyectos con busqueda/filtro |
| `/dashboard/projects/new` | Crear nuevo proyecto |
| `/dashboard/projects/[id]` | Detalle proyecto: 7 tabs (resumen, docs, inventario, contratos, alertas, ahorros, analisis IA) |
| `/dashboard/projects/[id]/upload` | Subir documentos al proyecto |
| `/dashboard/settings` | Ajustes: perfil, Google Drive, carpeta raiz |

### Componentes Frontend (`web/src/components/`)

| Componente | Tipo | Funcion |
|------------|------|---------|
| `advisor-chat.tsx` | Client | UI del chat: mensajes con markdown, adjuntos, boton exportar Word |
| `analysis-plan-review.tsx` | Client | HITL: visualizacion y aprobacion/rechazo del plan de analisis |
| `analysis-progress.tsx` | Client | Barras de progreso en tiempo real (Supabase Realtime) |
| `analysis-round2.tsx` | Client | HITL: preguntas de seguimiento ronda 2 |
| `google-drive-picker.tsx` | Client | Navegador de archivos Drive con breadcrumbs y seleccion |
| `model-selector.tsx` | Client | Selector de modelo LLM y tier (standard/PRO+) para advisor |
| `usage-dashboard.tsx` | Client | Dashboard de uso por proveedor, costes, limites |
| `sidebar.tsx` | Client | Menu de navegacion (5 items) + avatar + logout |
| `ui/badge.tsx` | shadcn | Badges con variantes de estado |
| `ui/button.tsx` | shadcn | Boton con variantes de tamano/estilo |
| `ui/card.tsx` | shadcn | Contenedor card |
| `ui/progress.tsx` | shadcn | Barra de progreso |
| `ui/table.tsx` | shadcn | Tabla con header/body/row/cell |

### Libreria Frontend (`web/src/lib/`)

| Archivo | Funcion |
|---------|---------|
| `env.ts` | `loadEnv()`: process.env → .env.local → .env con fallback |
| `export-word.ts` | Genera .docx con branding Vandarum (header teal, footer, disclaimer) |
| `render-markdown.ts` | Markdown → HTML con soporte de tablas (clases Tailwind) |
| `upload.ts` | Upload dual: base64 para <4MB, signed URL para >4MB |
| `utils.ts` | `cn()` para merge de clases Tailwind (clsx + tailwind-merge) |
| `vandarum-logo-data.ts` | Logo PNG en base64 para embeber en exportacion Word |
| `supabase/admin.ts` | `getAdminClient()`: factory de cliente con service_role key |
| `supabase/server.ts` | Cliente SSR con cookie handling |
| `supabase/client.ts` | Cliente browser |
| `supabase/middleware.ts` | `updateSession()` para refresh de sesion |

### Tipos TypeScript (`web/src/types/database.ts`)

85+ interfaces que mapean todas las tablas de Supabase:
- `Project`, `KnowledgeDocument`, `ProjectDocument`, `KnowledgeChunk`, `ProjectChunk`
- `ComplianceAlert`, `SavingsOpportunity`, `WasteInventory`, `Contract`, `WasteManager`
- `InvoiceLine`, `PipelineProgress`, `AnalysisSession`, `AnalysisProgress`
- `ConsultantGDrive`, `GDriveSyncLog`
- Enums: `KnowledgeDocType` (7 tipos), `ProjectDocType` (12 tipos)

### Pipeline de Procesamiento (`pipeline/`)

| Modulo | Funcion |
|--------|---------|
| `unified_ingestion.py` | Punto de entrada: detecta formato → enruta al procesador |
| `pdf_pipeline.py` | PDFs: digital, escaneado (OCR via Claude vision), hibrido, encriptado |
| `excel_processor.py` | Excel/CSV: extraccion de tablas |
| `text_processor.py` | DOCX/TXT/HTML: extraccion de texto |
| `extractor.py` | Extraccion general de contenido de documentos |
| `classifier_chunker.py` | Clasificacion de tipo doc + chunking semantico |
| `metadata_extractor.py` | Extraccion: codigos LER, fechas, precios, gestores |
| `storage.py` | Persistencia: Supabase DB (docs + chunks) + Storage (archivos) |
| `rag_scoping.py` | RAG dual: busqueda semantica en General y/o Proyecto |
| `config.py` | Config: API keys, EmbeddingService (OpenAI text-embedding-3-large) |
| `google_drive.py` | Google Drive: OAuth, listado BFS con retry, descarga con retry, sync |
| `model_router.py` | Enrutamiento multi-proveedor (Anthropic, OpenAI, Google) con fallback chain |
| `cost_guard.py` | Circuit breaker de costes: limites diarios/mensuales por proveedor, registro de uso |

### Agentes LangGraph (`pipeline/agents/`)

**Infraestructura:**

| Modulo | Funcion |
|--------|---------|
| `graph.py` | Grafo LangGraph: define nodos, edges, y flujo de ejecucion |
| `state.py` | Estado compartido entre agentes (TypedDict de LangGraph) |
| `llm.py` | Wrapper LLM multi-proveedor para agentes (usa ModelRouter + CostGuard) |
| `prompts.py` | Templates de system/user prompts para cada agente |
| `loader.py` | Carga documentos del proyecto desde Supabase para el analisis |
| `tools.py` | Herramientas (tools) disponibles para los agentes |

**Agentes** — ejecucion paralela de 5 analistas + 1 coordinador + 1 optimizador + 1 redactor:

| Agente | Que analiza | Tipos de hallazgo |
|--------|-------------|-------------------|
| `agent_coordinador.py` | Coordinacion del flujo | Orquesta la ejecucion de los agentes analistas |
| `agent_aai.py` | Autorizacion Ambiental Integrada | ler_no_autorizado, limite_excedido, condicion_incumplida |
| `agent_contratos.py` | Contratos con gestores | contrato_vencido, precio_alto, sin_contrato, gestor_no_autorizado |
| `agent_facturas.py` | Facturas de gestion | price_anomaly, quantity_mismatch, trend_alert |
| `agent_registro.py` | Registro produccion/cronologico | Consistencia LER, entradas faltantes |
| `agent_normativo.py` | Cumplimiento normativo | Riesgos vs Ley 7/2022, RD 553/2020, Directiva 2008/98/CE |
| `agent_optimizador.py` | Priorizacion | Severidad + ROI, deduplicacion |
| `agent_redactor.py` | Informe final | Resumen ejecutivo + secciones detalladas |

### Flujo de analisis multi-agente (HITL)

```
1. Consultor selecciona proyecto → POST /api/analyze-project
2. Backend crea analysis_session (status=planning)
3. FASE PLAN: agentes generan plan de analisis
   └─ Frontend muestra plan para revision (analysis-plan-review.tsx)
4. Consultor aprueba/modifica → POST /api/analyze-project/execute
5. FASE EJECUCION: 5 agentes analizan en paralelo
   ├─ Progreso via Supabase Realtime → analysis_progress
   └─ Frontend muestra barras en tiempo real (analysis-progress.tsx)
6. Optimizador prioriza + deduplica hallazgos
7. Redactor genera informe final
8. FASE ROUND 2 (opcional): consultor hace preguntas de seguimiento
   └─ POST /api/analyze-project/round2
```

### Flujo de sincronizacion Google Drive

```
1. Consultor conecta Drive (OAuth2) → consultant_gdrive
2. Auto-sync: cada 6h si pagina KB abierta y auto_sync_enabled=true
   └─ O manual: boton "Sincronizar ahora"
3. POST /api/gdrive/sync → crea gdrive_sync_log (status=running)
4. Background task (_run_sync_job):
   a. BFS iterativo de carpetas (con retry + pausa 0.3s entre carpetas)
   b. Deduplicacion: consulta drive_file_id en knowledge_documents
   c. Para cada archivo nuevo:
      ├─ download_file() con retry
      ├─ service.ingest() con timeout 5min
      └─ Actualizar progreso en gdrive_sync_log
   d. Final: status=completed + conteos
5. Stale sync: si lleva >120 min running → marcar como error
```

### Model Router y Cost Guard

**ModelRouter** (`pipeline/model_router.py`) — enruta llamadas LLM con fallback chain multi-proveedor:

```
Consultor envía consulta
        │
        ▼
  ModelRouter.execute()
        │
        ├── 1. get_consultant_chain() → [modelo1, modelo2, modelo3...]
        │       ├── Si model_override: ese modelo + defaults como fallback
        │       ├── Si consultant_model_config existe: usar config guardada
        │       └── Si no: usar SERVICE_DEFAULTS[servicio][tier]
        │
        ├── 2. Para cada modelo en la cadena:
        │       ├── CostGuard.check(proveedor, consultant_id) → ¿bloqueado?
        │       │       ├── Si: saltar al siguiente modelo
        │       │       └── No: continuar
        │       ├── Llamar al proveedor (Anthropic/OpenAI/Google)
        │       │       ├── Si exito: CostGuard.record() + return resultado
        │       │       └── Si error: CostGuard.record(success=false) + siguiente
        │       └── Repetir hasta exito o agotar cadena
        │
        └── 3. Si todos fallan: raise RuntimeError
```

**Tiers de servicio:**

| Tier | Advisor | Analysis | RAG | Pipeline |
|------|---------|----------|-----|----------|
| **standard** | Sonnet 4 → Gemini Pro → GPT-5 → Haiku | Sonnet 4 → GPT-5 → Gemini Pro → Haiku | Haiku → Gemini Flash → GPT-5 Mini | Haiku → Gemini Flash |
| **pro_plus** | Opus 4.6 → GPT-5.2 → o3 → Gemini Pro → Sonnet 4 | Sonnet 4 → GPT-5.2 → Gemini Pro | - | - |

**CostGuard** (`pipeline/cost_guard.py`) — circuit breaker de costes:

| Concepto | Detalle |
|----------|---------|
| Limites diarios/mensuales | Por proveedor (anthropic, openai, google) + global |
| Defaults | Anthropic: $10/dia, $100/mes. OpenAI: $5/dia, $50/mes. Google: $3/dia, $30/mes |
| Auto-fallback | Si un proveedor esta bloqueado, el router prueba el siguiente |
| Alerta | Warning al 80% del limite |
| Registro | Cada llamada se registra en `api_usage_log` con tokens, coste, duracion |

**Tablas Supabase para cost tracking** (ejecutar `supabase/cost_tracking.sql`):

| Tabla | Descripcion |
|-------|-------------|
| `api_usage_log` | Registro de cada llamada: modelo, proveedor, tokens, coste USD, duracion, exito |
| `consultant_cost_limits` | Limites configurables por consultor: diarios/mensuales por proveedor + global |
| `consultant_model_config` | Modelo preferido y fallback chain por consultor/servicio |

**Funciones RPC** (creadas por cost_tracking.sql):
- `get_provider_spending(p_consultant_id, p_provider)` — gasto diario y mensual de un proveedor
- `get_global_spending(p_consultant_id)` — gasto global diario y mensual

---

## Auditoria de Supabase - 25 febrero 2026

### Fuente de verdad: estado real de la base de datos

Datos obtenidos directamente de Supabase mediante consultas a `information_schema` y `pg_catalog`.

---

### 1. Tablas existentes (21)

| Tabla | Tipo | PK | Descripcion |
|-------|------|-----|-------------|
| `projects` | tabla | uuid | Entidad principal. Empresa/trabajo del consultor |
| `knowledge_documents` | tabla | text | RAG General: normativa, BREFs, directivas (Google Drive) |
| `knowledge_chunks` | tabla | text | Chunks + embeddings del RAG General |
| `project_documents` | tabla | text | RAG Proyecto: docs especificos de cada proyecto |
| `project_chunks` | tabla | text | Chunks + embeddings del RAG Proyecto |
| `compliance_alerts` | tabla | uuid | Alertas de cumplimiento normativo |
| `savings_opportunities` | tabla | uuid | Oportunidades de ahorro detectadas |
| `waste_inventory` | tabla | uuid | Inventario de residuos por proyecto |
| `waste_managers` | tabla | uuid | Gestores de residuos autorizados |
| `invoice_lines` | tabla | uuid | Lineas de facturas de gestion |
| `contracts` | tabla | uuid | Contratos con gestores |
| `pipeline_progress` | tabla | text (doc_id) | Progreso en tiempo real del pipeline de ingesta (Supabase Realtime) |
| `analysis_progress` | tabla | uuid | Progreso en tiempo real del analisis multi-agente (Supabase Realtime) |
| `analysis_sessions` | tabla | uuid | Estado de sesiones HITL (plan → execute → results → round2) |
| `consultant_gdrive` | tabla | uuid | Tokens OAuth de Google Drive por consultor |
| `gdrive_sync_log` | tabla | uuid | Log de sincronizaciones con Google Drive |
| `api_usage_log` | tabla | uuid | Registro de cada llamada API con coste (CostGuard) |
| `consultant_cost_limits` | tabla | consultant_id | Limites de coste por proveedor y globales |
| `consultant_model_config` | tabla | consultant_id+service | Config de modelo preferido por servicio |
| `knowledge_stats` | vista | - | Estadisticas agregadas del RAG General |
| `project_stats` | vista | - | Estadisticas agregadas del RAG Proyecto |

### 2. Arquitectura de datos

```
projects (uuid)
├── project_documents (text) ──→ project_chunks (text) [RAG Proyecto]
├── compliance_alerts (uuid)
├── savings_opportunities (uuid)
├── invoice_lines (uuid)
├── waste_inventory (uuid)
├── contracts (uuid) ──→ waste_managers (uuid)
├── analysis_progress (uuid) [Realtime: progreso de analisis multi-agente]
├── analysis_sessions (uuid) [HITL: estado entre fases del analisis]
└── project_chunks (uuid ref)

knowledge_documents (text) ──→ knowledge_chunks (text) [RAG General]
  (sin proyecto, accesible por todos los autenticados)

consultant_gdrive (uuid) ──→ auth.users
gdrive_sync_log (uuid) ──→ consultant_id (sin FK explicita)
pipeline_progress (text) ──→ sin FK [Realtime: progreso de ingesta de docs]

api_usage_log (uuid) ──→ consultant_id [Registro de cada llamada API + coste]
consultant_cost_limits (consultant_id PK) ──→ auth.users [Limites por proveedor]
consultant_model_config (consultant_id+service PK) ──→ auth.users [Config modelo preferido]
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
| analysis_progress | project_id | projects |
| analysis_sessions | project_id | projects |

### 4. Politicas RLS

| Tabla | Politica | Comando | Logica |
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
| `analysis_progress` | user_own_analysis_progress | ALL | `project_id IN (projects del consultor)` |
| `analysis_progress` | service_write_analysis_progress | ALL | `auth.role() = 'service_role'` |
| `analysis_sessions` | consultant_own_sessions | ALL | `consultant_id = auth.uid()` |
| `consultant_gdrive` | user_own_gdrive | ALL | `consultant_id = auth.uid()` |
| `gdrive_sync_log` | user_own_sync_log | ALL | `consultant_id = auth.uid()` |

**Tablas SIN politica RLS:** `pipeline_progress` (no tiene RLS habilitado - cualquiera puede leer/escribir)

### 5. Funciones RAG

Las tres funciones de busqueda existen y estan operativas:
- `search_knowledge` - Busqueda vectorial en RAG General
- `search_project` - Busqueda vectorial en RAG Proyecto
- `search_combined` - Busqueda combinada en ambos RAGs

### 6. Tablas obsoletas eliminadas

Las tablas del esquema antiguo ya NO existen (migracion 004 ejecutada correctamente):
- `clients` - eliminada
- `client_documents` - eliminada
- `document_chunks` - eliminada

---

### 7. Hallazgos de la auditoria

#### PROBLEMAS DETECTADOS

**P1: Error PGRST205 en "Base de Conocimiento"**
- **Sintoma:** La pagina muestra `Could not find the table 'public.knowledge_documents' in the schema cache`
- **Estado real:** La tabla SI existe, tiene 33 documentos, RLS esta activo, las politicas existen
- **Causa probable:** Cache de PostgREST desactualizado. Se ejecuto `NOTIFY pgrst, 'reload schema'` pero no se ha verificado si el error persiste
- **Accion pendiente:** Verificar si el error sigue apareciendo tras recargar la pagina

**P2: `pipeline_progress` sin RLS**
- La tabla `pipeline_progress` no tiene Row Level Security habilitado
- Cualquier usuario autenticado puede leer/escribir el progreso de cualquier documento
- **Riesgo:** Bajo (datos no sensibles, solo progreso de pipeline)
- **Recomendacion:** Considerar habilitar RLS si se quiere aislar por consultor

**P3: `gdrive_sync_log` sin FK a `auth.users`**
- La columna `consultant_id` no tiene foreign key a `auth.users`
- La politica RLS protege los datos, pero no hay integridad referencial
- **Riesgo:** Medio (podrian quedar registros huerfanos si se elimina un usuario)

**P4: `consultant_gdrive` sin FK a `auth.users` en Supabase**
- El script `setup.sql` del repo define `REFERENCES auth.users(id)` pero no aparece en las FK reales
- La politica RLS compensa, pero falta integridad referencial

**P5: Discrepancia knowledge_documents vs knowledge_chunks**
- 33 documentos pero solo 9 chunks
- Esto indica que la mayoria de documentos se registraron pero NO se particionaron correctamente
- Los documentos sin chunks no son buscables por RAG

**P6: Archivos SQL del repo desactualizados** ✅ RESUELTO
- Todos los archivos de migracion antiguos han sido eliminados del repo
- Solo quedan `setup.sql` (esquema base) y `verify_data.sql` (queries de diagnostico)

#### SIN PROBLEMAS

- Estructura de tablas principales correcta y completa
- Foreign keys bien definidas entre todas las tablas de proyecto
- Politicas RLS coherentes: cada consultor solo ve sus datos
- Knowledge base accesible en lectura por todos los autenticados, escritura solo por service_role
- Funciones RAG (search_knowledge, search_project, search_combined) existen
- Vistas de estadisticas (knowledge_stats, project_stats) existen
- Google Drive integration (consultant_gdrive, gdrive_sync_log) bien estructurada

---

### 8. Mapa de uso: que codigo toca que tabla

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

| Pagina | Tablas | Operaciones |
|--------|--------|-------------|
| `/dashboard` (SSR) | projects, knowledge_documents, compliance_alerts, savings_opportunities, project_documents | SELECT |

#### Pipeline Python (service_role)

| Modulo | Tablas | Operaciones |
|--------|--------|-------------|
| `api/server.py` | knowledge_documents, knowledge_chunks, consultant_gdrive, gdrive_sync_log, analysis_sessions, analysis_progress, api_usage_log, consultant_cost_limits, consultant_model_config | SELECT, UPSERT, UPDATE, DELETE, INSERT |
| `pipeline/storage.py` | knowledge_documents, knowledge_chunks, project_documents, project_chunks, waste_inventory, invoice_lines, compliance_alerts | UPSERT |
| `pipeline/pdf_pipeline.py` | pipeline_progress | UPSERT |
| `pipeline/agents/graph.py` | analysis_progress | INSERT (via Supabase Realtime) |
| `pipeline/rag_scoping.py` | (via RPC) search_knowledge, search_project | RPC |
| `pipeline/unified_ingestion.py` | knowledge_documents, knowledge_chunks, project_documents, project_chunks, waste_inventory, invoice_lines | UPSERT |

---

### 9. Acciones recomendadas (por prioridad)

1. **Verificar si PGRST205 persiste** - Recargar la pagina tras el NOTIFY pgrst
2. **Investigar por que 33 docs pero solo 9 chunks** - Los documentos sin chunks no funcionan en el RAG
3. ~~**Limpiar archivos SQL obsoletos del repo**~~ ✅ HECHO - Todos los migration files eliminados
4. **Evaluar FK faltantes** en gdrive_sync_log y consultant_gdrive hacia auth.users
5. **Evaluar RLS en pipeline_progress** si se quiere aislar por consultor

---

## Changelog

### 1 marzo 2026

#### Model Router multi-proveedor + CostGuard + PRO+

Sistema completo de enrutamiento de modelos con fallback chain y control de costes:

**Nuevos archivos:**
- `pipeline/model_router.py` — ModelRouter: fallback chain Anthropic → OpenAI → Google
- `pipeline/cost_guard.py` — CostGuard: circuit breaker de costes por proveedor
- `supabase/cost_tracking.sql` — Tablas: api_usage_log, consultant_cost_limits, consultant_model_config
- `web/src/components/model-selector.tsx` — Selector de modelo y tier (standard/PRO+)
- `web/src/components/usage-dashboard.tsx` — Dashboard de uso y costes

**Archivos modificados:**
- `api/server.py` — Advisor y analisis usan ModelRouter; 6 nuevos endpoints (usage-stats, cost-limits, model-config, available-models)
- `pipeline/agents/llm.py` — Reescrito: call_llm() usa ModelRouter, call_claude() es alias backward-compatible
- `pipeline/agents/state.py` — Nuevos campos: gemini_api_key, model_override, tier, consultant_id
- `pipeline/agents/graph.py` — run_project_analysis() acepta params de routing
- Los 8 agentes (aai, contratos, facturas, registro, normativo, optimizador, redactor, coordinador) — usan routing_kwargs(state)

**Modelos soportados:**
- Anthropic: Claude Opus 4.6, Sonnet 4, Haiku 4.5
- OpenAI: GPT-5.2, GPT-5, o3, o4-mini, GPT-5 Mini
- Google: Gemini 2.5 Pro, Gemini 2.5 Flash

**Nuevos endpoints:**

| Metodo | Ruta | Descripcion |
|--------|------|-------------|
| GET | `/api/usage-stats` | Estadisticas de uso y costes |
| GET/PUT | `/api/cost-limits` | Limites de coste por proveedor |
| GET/PUT | `/api/model-config` | Config de modelo por servicio |
| GET | `/api/available-models` | Modelos disponibles con capacidades |

### 25 febrero 2026

#### Actualizacion comprehensiva de CLAUDE.md

Reorganizacion y ampliacion del archivo CLAUDE.md para reflejar el estado actual del proyecto:
- Nuevo: Resumen del proyecto, Stack tecnologico, Estructura del repositorio
- Nuevo: Configuracion de desarrollo (requisitos, variables de entorno, scripts)
- Nuevo: Arquitectura de deployment (Vercel + Railway + Supabase)
- Nuevo: Componentes Frontend, Libreria Frontend, Tipos TypeScript
- Nuevo: Infraestructura de agentes (graph, state, llm, prompts, loader, tools)
- Nuevo: Flujo de analisis multi-agente HITL
- Actualizado: Endpoints Python (+ advisor/stream)
- Actualizado: API Routes Next.js (+ stream, analyze-project HITL)
- Actualizado: Agentes LangGraph (+ agent_coordinador, modulos infra)
- Actualizado: Pipeline (+ extractor.py)

### 24 febrero 2026

#### Mejora calidad Asesor IA

| Parametro | Antes | Despues |
|-----------|-------|---------|
| System prompt | Instrucciones basicas | + seccion de profundidad: exhaustivo, calidad profesional, 500-1000 palabras minimo, anticipar preguntas de seguimiento |
| Extended thinking budget | 10,000 tokens | 24,000 tokens |
| RAG top_k por scope | 8 | 12 |
| RAG similarity threshold | 0.60 | 0.65 |
| Metodo de razonamiento | 5 pasos basicos | 7 pasos con analisis de alternativas y recomendaciones |

**Archivos modificados:** `api/server.py` (ADVISOR_SYSTEM_PROMPT, parametros RAG, thinking budget)

#### Exportar respuestas a Word (.docx)

Nuevo boton "Word" en cada respuesta del asesor que genera un documento .docx con marca Vandarum:
- Header: barra teal con "VANDARUM" + "Informe del Asesor IA"
- Secciones: Consulta, Analisis y Recomendaciones, Fuentes Consultadas
- Conversion de markdown a formato Word (negritas, cursivas, listas, encabezados)
- Footer: "Generado por ResidusIA Pro — vandarum.com"
- Disclaimer legal

**Archivos creados:** `web/src/lib/export-word.ts`
**Archivos modificados:** `web/src/app/dashboard/advisor/page.tsx` (boton Download, import lucide-react)
**Dependencias anadidas:** `docx`, `file-saver`, `@types/file-saver`

#### Google Drive Sync resiliente

**Problema:** El sync de 799 archivos fallaba por HttpError 500 de Google y timeout de 30 min.

**Cambios en `pipeline/google_drive.py`:**

| Funcion | Antes | Despues |
|---------|-------|---------|
| `list_folder()` | Sin retry, falla al primer error | 4 intentos con backoff exponencial (1s, 2s, 4s, 8s) en HTTP 500/502/503/429 |
| `download_file()` | Sin retry | 4 intentos con backoff en metadata y descarga |
| `list_all_files_recursive()` | Recursion profunda, sin pausa, sin logging | BFS iterativo con `deque`, pausa 0.3s entre carpetas, log cada 20 carpetas |

**Cambios en `api/server.py`:**

| Parametro | Antes | Despues |
|-----------|-------|---------|
| Stale sync timeout | 30 minutos | 120 minutos |
| Endpoint `POST /api/gdrive/sync-all` | Existia (cron no configurado) | Eliminado |
