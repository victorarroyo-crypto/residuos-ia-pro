# ResidusIA Pro

Plataforma SaaS de consultoria ambiental para gestion de residuos industriales en Espana. Combina inteligencia artificial multi-proveedor (Anthropic Claude, OpenAI GPT, Google Gemini) con enrutamiento inteligente (ModelRouter + CostGuard), RAG dual, agentes LangGraph y Google Drive para ofrecer un asistente experto, analisis automatizado de proyectos y gestion documental completa.

---

## Arquitectura General

```
                    USUARIO (navegador)
                         |
              ┌──────────┴──────────┐
              │   Next.js 14 (web/) │  ← Vercel
              │   App Router + SSR  │
              └──────────┬──────────┘
                         │
          ┌──────────────┼──────────────┐
          │              │              │
   API Routes      Supabase Auth   Static Assets
   (Next.js)       (JWT + RLS)
          │
          ▼
┌─────────────────────┐     ┌──────────────────┐
│  FastAPI (api/)      │────→│  Supabase        │
│  Python Pipeline     │     │  PostgreSQL      │
│  LangGraph Agents    │     │  pgvector        │
│  Google Drive Sync   │     │  Storage (S3)    │
└─────────────────────┘     └──────────────────┘
          │
          ├── ModelRouter + CostGuard (fallback chain)
          │     ├── Anthropic: Claude Opus 4.6, Sonnet 4, Haiku 4.5
          │     ├── OpenAI: GPT-5.2, GPT-5, o3, o4-mini
          │     └── Google: Gemini 2.5 Pro, Gemini 2.5 Flash
          ├── OpenAI text-embedding-3-large (embeddings)
          └── Google Drive API (OAuth2)
```

## Stack Tecnologico

| Capa | Tecnologia | Uso |
|------|-----------|-----|
| Frontend | Next.js 14, React, Tailwind CSS, shadcn/ui | SPA con SSR, UI responsive |
| Backend API | Python FastAPI (async) | Ingestion, RAG, advisor, agentes |
| Base de datos | Supabase (PostgreSQL + pgvector) | Datos, embeddings, auth, RLS |
| Almacenamiento | Supabase Storage (S3) | PDFs, Excel, documentos originales |
| LLM (Anthropic) | Claude Opus 4.6, Sonnet 4, Haiku 4.5 | Asesor IA, agentes, clasificacion |
| LLM (OpenAI) | GPT-5.2, GPT-5, o3, o4-mini, GPT-5 Mini | Fallback LLM |
| LLM (Google) | Gemini 2.5 Pro, Gemini 2.5 Flash | Fallback LLM |
| Model Router | Custom (fallback chain + CostGuard) | Enrutamiento multi-proveedor con control de costes |
| Embeddings | OpenAI text-embedding-3-large (1536 dims) | Busqueda semantica RAG |
| Agentes | LangGraph StateGraph | Analisis paralelo de proyectos |
| Drive | Google Drive API + OAuth2 | Sync automatico de documentos |
| Deploy | Vercel (frontend) + Railway (backend) | Serverless + contenedor |

---

## Estructura del Repositorio

```
residuos-ia-pro/
├── api/
│   └── server.py                ← FastAPI: todos los endpoints Python
├── pipeline/
│   ├── unified_ingestion.py     ← Punto de entrada unico de ingestion
│   ├── pdf_pipeline.py          ← PDFs: OCR, tablas, encriptados
│   ├── excel_processor.py       ← Excel/CSV
│   ├── text_processor.py        ← DOCX/TXT/HTML
│   ├── classifier_chunker.py    ← Clasificacion + chunking semantico
│   ├── metadata_extractor.py    ← Extraccion de LER, fechas, precios
│   ├── storage.py               ← Persistencia en Supabase
│   ├── rag_scoping.py           ← Sistema RAG dual (General + Proyecto)
│   ├── config.py                ← Config + EmbeddingService
│   ├── google_drive.py          ← OAuth, sync, descarga de Drive
│   ├── model_router.py          ← ModelRouter: fallback chain multi-proveedor
│   ├── cost_guard.py            ← CostGuard: circuit breaker de costes
│   └── agents/                  ← LangGraph: agentes de analisis
│       ├── graph.py             ← StateGraph (orquestador)
│       ├── state.py             ← AnalysisState (TypedDict)
│       ├── loader.py            ← Carga datos proyecto desde Supabase
│       ├── llm.py               ← Wrapper LLM multi-proveedor (usa ModelRouter)
│       ├── prompts.py           ← System prompts por agente
│       ├── agent_aai.py         ← Autorizacion Ambiental Integrada
│       ├── agent_contratos.py   ← Contratos con gestores
│       ├── agent_facturas.py    ← Facturas de gestion
│       ├── agent_registro.py    ← Registro produccion/cronologico
│       ├── agent_normativo.py   ← Cumplimiento normativo
│       ├── agent_optimizador.py ← Priorizacion por severidad + ROI
│       └── agent_redactor.py    ← Generacion de informe final
├── web/
│   ├── src/
│   │   ├── app/
│   │   │   ├── page.tsx                     ← Landing page
│   │   │   ├── login/page.tsx               ← Login
│   │   │   ├── register/page.tsx            ← Registro
│   │   │   ├── auth/callback/route.ts       ← OAuth callback
│   │   │   ├── dashboard/
│   │   │   │   ├── layout.tsx               ← Layout con sidebar
│   │   │   │   ├── page.tsx                 ← Dashboard: KPIs, alertas, resumen
│   │   │   │   ├── advisor/page.tsx         ← Asesor IA: chat + adjuntos + Word
│   │   │   │   ├── knowledge-base/page.tsx  ← Base de Conocimiento + Drive sync
│   │   │   │   ├── projects/page.tsx        ← Lista de proyectos
│   │   │   │   ├── projects/new/page.tsx    ← Crear proyecto
│   │   │   │   ├── projects/[id]/page.tsx   ← Detalle: docs, inventario, agentes
│   │   │   │   ├── projects/[id]/upload/    ← Subida de documentos
│   │   │   │   └── settings/page.tsx        ← Ajustes + Google Drive
│   │   │   └── api/                         ← 24 API routes (proxy a Python)
│   │   ├── components/
│   │   │   ├── sidebar.tsx                  ← Navegacion principal
│   │   │   ├── google-drive-picker.tsx      ← Widget Google Picker
│   │   │   ├── model-selector.tsx           ← Selector modelo/tier (standard/PRO+)
│   │   │   ├── usage-dashboard.tsx          ← Dashboard uso y costes
│   │   │   └── ui/                          ← shadcn/ui (button, card, badge...)
│   │   ├── lib/
│   │   │   ├── supabase/                    ← Clientes Supabase (client/server/admin)
│   │   │   ├── export-word.ts               ← Exportar respuesta a Word (.docx)
│   │   │   ├── upload.ts                    ← Orquestacion de subida de archivos
│   │   │   ├── env.ts                       ← Variables de entorno
│   │   │   └── utils.ts                     ← Utilidades comunes
│   │   └── types/
│   │       └── database.ts                  ← Tipos TypeScript de las tablas
│   ├── vercel.json                          ← Deploy config (region cdg1, timeouts)
│   ├── next.config.mjs                      ← Next.js config
│   └── tailwind.config.ts                   ← Colores Vandarum
├── supabase/
│   ├── setup.sql                            ← Esquema completo
│   ├── cost_tracking.sql                    ← Tablas cost tracking + RPC functions
│   └── verify_data.sql                      ← Diagnostico
├── CLAUDE.md                                ← Documentacion tecnica + auditoria
└── README.md                                ← Este archivo
```

---

## Funcionalidades Principales

### 1. Asesor IA Experto (`/dashboard/advisor`)

Chat interactivo con un experto en gestion de residuos industriales:
- **Multi-proveedor:** Claude, GPT, Gemini con fallback automatico via ModelRouter
- **Tier Standard:** Claude Sonnet 4 (fallback: Gemini Pro → GPT-5 → Haiku)
- **Tier PRO+:** Claude Opus 4.6 (fallback: GPT-5.2 → o3 → Gemini Pro → Sonnet 4)
- **Adjuntos:** hasta 6 archivos (PDF, Excel, Word, imagenes) o URLs por consulta
- **RAG dual:** busca en Base de Conocimiento (normativa) y documentos de proyecto
- **Busqueda web:** para datos actualizados (precios, BOE reciente, gestores)
- **Extended thinking:** 24,000 tokens de razonamiento interno
- **CostGuard:** control automatico de costes con limites por proveedor
- **Exportar a Word:** boton para descargar la respuesta como .docx con marca Vandarum

**Flujo:**
```
Pregunta + adjuntos → RAG search (top_k=12) → ModelRouter (fallback chain) + web search → Respuesta estructurada
```

### 2. Analisis Automatizado de Proyectos (`/dashboard/projects/[id]`)

Sistema multi-agente con LangGraph que analiza un proyecto completo:

| Agente | Que analiza |
|--------|-------------|
| **AAI** | Autorizacion Ambiental: LER autorizados vs inventario real |
| **Contratos** | Vencimientos, precios vs mercado, gestores no autorizados |
| **Facturas** | Anomalias de precio, discrepancias de cantidad, tendencias |
| **Registro** | Libro cronologico, DARI, plazos almacenamiento |
| **Normativo** | Cumplimiento Ley 7/2022, RD 553/2020, Directiva 2008/98/CE |
| **Optimizador** | Prioriza hallazgos por severidad + ROI |
| **Redactor** | Genera informe ejecutivo final |

Los 5 agentes principales corren en paralelo, seguidos del optimizador y redactor.

### 3. Base de Conocimiento (`/dashboard/knowledge-base`)

RAG General con normativa y documentos de referencia:
- Subida directa o desde Google Drive
- Sincronizacion automatica cada 6h (si la pagina esta abierta y auto-sync activo)
- Sincronizacion manual bajo demanda
- Navegador de archivos de Google Drive integrado

### 4. Ingestion de Documentos (pipeline)

Pipeline unificado que procesa cualquier formato:

| Formato | Capacidades |
|---------|-------------|
| **PDF** | Digital, escaneado (OCR via Claude vision), hibrido, encriptado |
| **Excel/CSV** | Extraccion de tablas, deteccion de estructura |
| **DOCX/TXT/HTML** | Texto plano con deteccion de tipo |

**Proceso:**
```
Archivo → Detectar formato → Extraer texto/tablas → Clasificar tipo doc
→ Chunking semantico → Embeddings (OpenAI) → Extraer metadata (LER, fechas)
→ Almacenar en Supabase (DB + Storage)
```

### 5. Google Drive Integration (`/dashboard/settings`)

- OAuth2 por consultor (cada uno conecta su Drive)
- Creacion automatica de estructura de carpetas
- Sync resiliente: retry con backoff exponencial, BFS iterativo
- Auto-sync cada 6h cuando la pagina esta abierta

### 6. Model Router y Control de Costes

**ModelRouter** — enrutamiento inteligente de llamadas LLM con fallback automatico:

| Proveedor | Modelos | Casos de uso |
|-----------|---------|-------------|
| **Anthropic** | Opus 4.6, Sonnet 4, Haiku 4.5 | Advisor PRO+, agentes, clasificacion |
| **OpenAI** | GPT-5.2, GPT-5, o3, o4-mini, GPT-5 Mini | Fallback LLM, analisis |
| **Google** | Gemini 2.5 Pro, Gemini 2.5 Flash | Fallback LLM, RAG |

**CostGuard** — circuit breaker que evita exceso de gasto:
- Limites diarios y mensuales por proveedor + global
- Auto-fallback: si un proveedor esta bloqueado, el router prueba el siguiente
- Registro detallado en `api_usage_log` con tokens, coste, duracion
- Dashboard de uso para el consultor (`usage-dashboard.tsx`)

**Endpoints de gestion:**

| Endpoint | Descripcion |
|----------|-------------|
| `GET /api/usage-stats` | Estadisticas de uso y costes |
| `GET/PUT /api/cost-limits` | Limites de coste por proveedor |
| `GET/PUT /api/model-config` | Modelo preferido por servicio |
| `GET /api/available-models` | Modelos con capacidades y precios |

### 7. Gestion de Proyectos (`/dashboard/projects`)

CRUD completo de proyectos (empresa/cliente del consultor):
- Datos empresa: nombre, CIF, CNAE, sector, direccion, contacto
- Documentos del proyecto (RAG Proyecto aislado por consultor)
- Inventario de residuos con codigos LER
- Contratos con gestores autorizados
- Alertas de cumplimiento
- Oportunidades de ahorro

---

## Base de Datos (Supabase)

### RAG Dual

```
RAG General (accesible por todos los autenticados):
  knowledge_documents → knowledge_chunks (embeddings 1536 dims)

RAG Proyecto (aislado por consultor via RLS):
  project_documents → project_chunks (embeddings 1536 dims)
```

### Tablas principales (19)

| Tabla | Descripcion |
|-------|-------------|
| `projects` | Proyectos (empresa/trabajo del consultor) |
| `knowledge_documents` | Documentos normativos del RAG General |
| `knowledge_chunks` | Chunks + embeddings del RAG General |
| `project_documents` | Documentos especificos de cada proyecto |
| `project_chunks` | Chunks + embeddings del RAG Proyecto |
| `compliance_alerts` | Alertas de cumplimiento normativo |
| `savings_opportunities` | Oportunidades de ahorro detectadas |
| `waste_inventory` | Inventario de residuos por proyecto |
| `waste_managers` | Gestores de residuos autorizados |
| `invoice_lines` | Lineas de facturas de gestion |
| `contracts` | Contratos con gestores |
| `pipeline_progress` | Progreso pipeline de ingesta |
| `consultant_gdrive` | Tokens OAuth Google Drive |
| `gdrive_sync_log` | Log de sincronizaciones |
| `api_usage_log` | Registro de llamadas API con coste |
| `consultant_cost_limits` | Limites de coste por proveedor |
| `consultant_model_config` | Modelo preferido por servicio |
| `knowledge_stats` | Vista: estadisticas RAG General |
| `project_stats` | Vista: estadisticas RAG Proyecto |

### Seguridad (RLS)

- Cada consultor solo ve sus propios proyectos y datos derivados
- Knowledge base: lectura para todos los autenticados, escritura solo service_role
- Google Drive tokens aislados por consultor

Ver `CLAUDE.md` para la auditoria completa de FK, RLS y funciones.

---

## Setup

### Frontend (Next.js)

```bash
cd web
npm install
cp .env.local.example .env.local
# Rellenar: NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY,
#           SUPABASE_SERVICE_ROLE_KEY, PIPELINE_API_URL
npm run dev
```

### Pipeline (Python)

```bash
pip install -r requirements.txt
cp .env.example .env
# Rellenar: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY,
#           ANTHROPIC_API_KEY, OPENAI_API_KEY,
#           GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET
python -m api.server
```

### Supabase

Ejecutar en el SQL Editor de Supabase:
1. `supabase/setup.sql` — Esquema base (tablas, indices, funciones RAG)
2. `supabase/cost_tracking.sql` — Cost tracking (api_usage_log, limites, model config)

## Variables de Entorno

### Frontend (.env.local)

```
NEXT_PUBLIC_SUPABASE_URL=https://xxx.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJ...
SUPABASE_SERVICE_ROLE_KEY=eyJ...
PIPELINE_API_URL=http://localhost:8000
FRONTEND_URL=http://localhost:3000
```

### Backend (.env)

```
SUPABASE_URL=https://xxx.supabase.co
SUPABASE_SERVICE_ROLE_KEY=eyJ...
ANTHROPIC_API_KEY=sk-ant-...
OPENAI_API_KEY=sk-...
GEMINI_API_KEY=AI...                    # Google Gemini (opcional, fallback LLM)
GOOGLE_CLIENT_ID=xxx.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=GOCSPX-...
FRONTEND_URL=http://localhost:3000
```

---

## Deploy

| Componente | Plataforma | Config |
|---|---|---|
| Frontend | Vercel | `web/vercel.json` (region cdg1 Paris, timeouts 120s) |
| Backend | Railway | `railway.json` / Dockerfile |
| Base de datos | Supabase Cloud | Proyecto en Supabase Dashboard |

---

## Flujo de Datos Principal

```
1. Consultor se registra → Supabase Auth
2. Conecta Google Drive → OAuth2 → consultant_gdrive
3. Crea proyecto (empresa) → projects
4. Sube documentos:
   ├─ Directos: archivo → pipeline → project_documents + project_chunks
   └─ Drive: sync → pipeline → knowledge_documents + knowledge_chunks
5. Pipeline extrae:
   ├─ Texto + tablas + metadata
   ├─ Codigos LER, fechas, precios
   ├─ Clasificacion de tipo de documento
   └─ Chunks + embeddings para RAG
6. Consultor pregunta al Asesor IA:
   └─ RAG search → ModelRouter (Claude/GPT/Gemini) → respuesta experta → (opcional) Word
7. Consultor lanza analisis de proyecto:
   └─ 5 agentes en paralelo (via ModelRouter) → optimizador → informe final
8. CostGuard registra cada llamada API:
   └─ api_usage_log → limites diarios/mensuales → auto-fallback si bloqueado
```
