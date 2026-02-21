# BRIEFING COMPLETO PARA CLAUDE CODE
# ResidusIA Pro — Plataforma de Consultoría de Gestión de Residuos Industriales
# =============================================================================

## TU ROL

Eres el ingeniero principal de **ResidusIA Pro**, una plataforma SaaS de consultoría
ambiental especializada en gestión de residuos industriales en España y Europa.

El producto lo construye un consultor experto (el usuario) que:
- Gestiona 10-50 clientes industriales en régimen de retainer, auditoría y diagnóstico
- Maneja toda la documentación regulatoria de sus clientes (AAI, contratos, facturas, registros)
- Necesita reducir costes de gestión de residuos de sus clientes manteniendo cumplimiento legal estricto
- Quiere escalar su consultoría con IA agéntica que automatice el análisis

**Principio rector de negocio**: La normativa es el suelo mínimo que nunca se puede
traspasar. Dentro de ese suelo, el objetivo es minimizar costes de gestión.

---

## ARQUITECTURA GENERAL DEL SISTEMA

```
┌─────────────────────────────────────────────────────────────────┐
│  FRONTEND: Next.js 14 + Tailwind + shadcn/ui → Vercel          │
│  (o Lovable como alternativa de UI si se prefiere velocidad)    │
└──────────────────────────┬──────────────────────────────────────┘
                           │ API calls
┌──────────────────────────▼──────────────────────────────────────┐
│  BACKEND: Supabase                                               │
│  ├── PostgreSQL + pgvector (RAG semántico)                      │
│  ├── Auth (login del consultor)                                 │
│  ├── Storage (PDFs originales)                                  │
│  ├── Edge Functions (lógica IA, ingesta, RAG)                   │
│  └── Realtime (progreso pipeline en tiempo real a la UI)        │
└──────────────────────────┬──────────────────────────────────────┘
                           │
┌──────────────────────────▼──────────────────────────────────────┐
│  PIPELINE DE DOCUMENTOS (Python — este repo)                    │
│  ├── PDF Pipeline (OCR, tablas, encriptados)                    │
│  ├── Excel Processor (costes, inventarios, registros)           │
│  ├── RAG Scoping (general vs proyecto)                          │
│  └── Unified Ingestion (punto de entrada único)                 │
└──────────────────────────┬──────────────────────────────────────┘
                           │
┌──────────────────────────▼──────────────────────────────────────┐
│  AGENTES IA (LangGraph — próxima fase)                          │
│  ├── AgenteAAI → analiza autorizaciones ambientales             │
│  ├── AgenteContratos → analiza precios y cláusulas              │
│  ├── AgenteFacturas → detecta anomalías financieras             │
│  ├── AgenteRegistro → detecta incumplimientos de plazos         │
│  ├── AgenteNormativo → consulta RAG de normativa                │
│  ├── AgenteOptimizador → cruza hallazgos y calcula ahorros      │
│  └── AgenteRedactor → genera informes ejecutivos                │
└─────────────────────────────────────────────────────────────────┘
```

---

## STACK TECNOLÓGICO DEFINITIVO

| Capa | Tecnología | Razón |
|---|---|---|
| Framework agentes | **LangGraph** | Control total del flujo, escalable a SaaS |
| LLM análisis | **Claude 3.5 Sonnet** (Anthropic) | Mejor para documentos largos en español |
| LLM clasificación rápida | **Claude 3.5 Haiku** | Barato, rápido para tareas simples |
| LLM docs muy largos | **Gemini 1.5 Pro** | Ventana 1M tokens para AAIs extensas |
| Embeddings | **OpenAI text-embedding-3-large** | 1536 dims, mejor calidad semántica |
| Base de datos | **Supabase** (pgvector) | PostgreSQL + vectores + auth + realtime |
| Storage docs | **Supabase Storage** + **Google Drive** | Drive para el consultor, Supabase para la app |
| Frontend | **Next.js 14** + Tailwind + shadcn/ui | O Lovable para UI rápida |
| Deploy agentes | **Railway** o **Fly.io** (Python) | Backend Python separado del frontend |
| Deploy UI | **Vercel** | Integración nativa con Next.js |
| Observabilidad | **LangSmith** | Trazabilidad completa de agentes |

---

## ESTRUCTURA DEL REPOSITORIO (ya creada)

```
residuos_pdf_pipeline/
├── README.md                    ← documentación completa del pipeline
├── requirements.txt             ← dependencias Python
│
├── config/
│   ├── config.py                ← PipelineConfigImpl, EmbeddingService
│   ├── schema.sql               ← tablas principales Supabase
│   └── schema_scoping.sql       ← tablas adicionales para RAG scoping
│
└── core/
    ├── pdf_pipeline.py          ← ORQUESTADOR PRINCIPAL del pipeline PDF
    ├── extractor.py             ← detección naturaleza + OCR + extracción tablas
    ├── classifier_chunker.py    ← clasificación tipo doc + chunking semántico
    ├── metadata_extractor.py    ← extracción estructurada (LERs, precios, fechas)
    ├── storage.py               ← Supabase + Google Drive
    ├── excel_processor.py       ← procesador Excel/CSV con representación textual
    ├── rag_scoping.py           ← sistema de dos capas RAG (general vs proyecto)
    └── unified_ingestion.py     ← PUNTO DE ENTRADA ÚNICO para cualquier documento
```

---

## MODELO DE DATOS SUPABASE (esquema completo)

### Tablas del dominio de negocio

```sql
-- Clientes industriales
clients (
  id UUID PK,
  nombre TEXT,
  cnae TEXT,              -- código de actividad económica
  sector TEXT,
  comunidad TEXT,         -- comunidad autónoma
  municipio TEXT,
  consultant_id UUID,     -- FK a auth.users (el consultor dueño)
  tipo_relacion TEXT,     -- 'retainer' | 'auditoria' | 'diagnostico'
  activo BOOLEAN,
  metadata JSONB          -- número AAI, inscripción registro productor, etc.
)

-- Proyectos (cada cliente puede tener varios)
projects (
  id UUID PK,
  client_id UUID FK → clients,
  consultant_id UUID FK → auth.users,
  nombre TEXT,
  tipo TEXT,              -- 'diagnostico_inicial' | 'retainer_anual' | 'auditoria' | 'optimizacion_puntual'
  estado TEXT,            -- 'activo' | 'completado' | 'pausado'
  fecha_inicio DATE,
  fecha_fin DATE
)

-- Inventario de residuos por cliente
waste_inventory (
  id UUID PK,
  client_id UUID FK → clients,
  codigo_ler TEXT,        -- ej: "120101" o "12 01 01"
  descripcion TEXT,
  peligroso BOOLEAN,
  cantidad_anual_ton DECIMAL,
  gestor_actual TEXT,
  precio_actual_eur_ton DECIMAL,
  operacion TEXT,         -- D1-D15 (eliminación) / R1-R13 (valorización)
  frecuencia_recogida TEXT,
  año INT,
  fuente_doc_id TEXT      -- FK → client_documents (de dónde vienen los datos)
)

-- Gestores de residuos autorizados (base de mercado del consultor)
waste_managers (
  id UUID PK,
  nombre TEXT,
  nif TEXT,
  numero_autorizacion TEXT,
  ccaa_autorizacion TEXT[],
  codigos_ler_autorizados TEXT[],
  operaciones_autorizadas TEXT[],
  precio_referencia_eur_ton DECIMAL,  -- benchmark de mercado
  valoracion DECIMAL,                  -- valoración del consultor 1-5
  activo BOOLEAN
)

-- Contratos con gestores
contracts (
  id UUID PK,
  client_id UUID FK → clients,
  manager_id UUID FK → waste_managers,
  fecha_inicio DATE,
  fecha_vencimiento DATE,
  codigos_ler TEXT[],
  precio_eur_ton DECIMAL,
  condiciones JSONB,
  drive_file_id TEXT,
  alertar_dias_antes INT DEFAULT 90
)

-- Oportunidades de ahorro detectadas por IA
savings_opportunities (
  id UUID PK,
  client_id UUID FK → clients,
  waste_id UUID FK → waste_inventory,
  tipo TEXT,              -- 'cambio_gestor' | 'cambio_operacion' | 'mejora_segregacion' |
                          -- 'reduccion_frecuencia' | 'simbiosis_industrial' | 'prevencion'
  descripcion TEXT,
  ahorro_estimado_eur_año DECIMAL,
  inversion_necesaria DECIMAL,
  payback_meses INT,
  norma_aplicable TEXT,  -- validación legal de la propuesta
  estado TEXT,           -- 'detectada' | 'propuesta' | 'aceptada' | 'implementada' | 'descartada'
  ia_generada BOOLEAN DEFAULT true
)

-- Auditorías y diagnósticos
audits (
  id UUID PK,
  client_id UUID FK → clients,
  tipo TEXT,             -- 'diagnostico_inicial' | 'auditoria_periodica' | 'seguimiento'
  fecha DATE,
  checklist JSONB,
  no_conformidades JSONB,
  ahorro_detectado_total DECIMAL,
  informe_drive_id TEXT,
  estado TEXT
)
```

### Tablas del pipeline de documentos

```sql
-- Documentos procesados (PDF, Excel, CSV)
client_documents (
  id TEXT PK,            -- "doc_{hash}" o "xls_{hash}"
  client_id UUID FK → clients,
  titulo TEXT,
  tipo TEXT,             -- DocType enum (ver abajo)
  naturaleza_pdf TEXT,   -- 'digital' | 'scanned' | 'hybrid' | 'encrypted' | 'excel'
  total_paginas INT,
  total_chunks INT,
  tablas_encontradas INT,
  ocr_aplicado BOOLEAN,
  ocr_confianza_media DECIMAL,
  fue_encriptado BOOLEAN,
  drive_file_id TEXT,
  advertencias TEXT[],
  metadata JSONB,        -- datos estructurados extraídos por el metadata extractor
  estado TEXT,           -- 'procesando' | 'indexado' | 'error' | 'pendiente'
  fecha_documento DATE,
  fecha_vencimiento DATE,
  fecha_ingesta TIMESTAMPTZ
)

-- Chunks con embeddings (el corazón del RAG)
document_chunks (
  id TEXT PK,            -- "{doc_id}_chunk_{index}"
  document_id TEXT FK → client_documents,
  chunk_index INT,
  contenido TEXT,        -- texto del chunk (lo que se embebe)
  embedding VECTOR(1536),-- OpenAI text-embedding-3-large
  chunk_type TEXT,       -- 'texto' | 'tabla' | 'seccion' | 'clausula' | 'excel_sheet'
  page_start INT,
  page_end INT,
  tokens INT,
  rag_scope TEXT,        -- 'general' (normativa) | 'project' (cliente específico)
  project_id UUID FK → projects,
  metadata JSONB
)

-- Líneas de facturas (para tracking financiero)
invoice_lines (
  id UUID PK,
  client_id UUID FK → clients,
  doc_id TEXT FK → client_documents,
  fecha DATE,
  codigo_ler TEXT,
  cantidad_toneladas DECIMAL,
  precio_unitario DECIMAL,
  importe_eur DECIMAL
)

-- Alertas de cumplimiento generadas automáticamente
compliance_alerts (
  id UUID PK,
  client_id UUID FK → clients,
  tipo TEXT,
  descripcion TEXT,
  severidad TEXT,        -- 'baja' | 'media' | 'alta' | 'critica'
  doc_id TEXT FK → client_documents,
  estado TEXT,           -- 'pendiente' | 'vista' | 'resuelta' | 'descartada'
  fecha_limite DATE
)

-- Progreso del pipeline (para Realtime → UI)
pipeline_progress (
  doc_id TEXT PK,
  step TEXT,             -- ver pasos del pipeline abajo
  percentage INT,        -- 0-100
  mensaje TEXT,
  error TEXT
)
```

### Funciones SQL críticas

```sql
-- Búsqueda semántica con scoping
search_chunks_scoped(query_embedding, rag_scope_filter, client_id_filter,
                     project_id_filter, doc_type_filter, match_threshold, match_count)

-- Búsqueda combinada (general + proyecto en una llamada)
search_chunks_combined(query_embedding, client_id_filter, project_id_filter,
                       doc_type_filter, match_threshold, match_count_general, match_count_project)
```

---

## TIPOS DE DOCUMENTO (DocType enum)

```python
# PDFs
"autorizacion_ambiental_integrada"  # AAI — el documento más crítico
"declaracion_anual_residuos"        # DARI — declaración anual obligatoria
"contrato_gestor"                   # contratos con empresas gestoras
"factura"                           # facturas de gestión
"registro_produccion"               # libro de registro de residuos
"permiso_ambiental"                 # permisos específicos
"manual_interno"                    # procedimientos internos del cliente
"normativa"                         # leyes, decretos, directivas (RAG general)

# Excel/CSV
"costes_anuales"                    # tabla €/t por LER y año
"inventario_ler"                    # listado de residuos generados
"comparativa_gestores"              # comparativa de ofertas
"registro_produccion"               # registro en formato tabla
"facturas_agregadas"                # resumen de facturas
"presupuesto"                       # propuesta de gestión
```

---

## SISTEMA DE RAG EN DOS CAPAS

### Concepto fundamental

```
RAG GENERAL (rag_scope = "general")
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Qué contiene: normativa europea y española, BREFs, guías técnicas IHOBE,
              precios de mercado de gestores, benchmarks de costes por sector/LER
Quién puede leerlo: TODOS los proyectos, todos los clientes
Quién puede escribirlo: solo el consultor (tú)
Caso de uso: "¿Qué dice el artículo 26 de la Ley 7/2022 sobre productores de
              residuos peligrosos?" → busca en RAG general

RAG DE PROYECTO (rag_scope = "project")
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Qué contiene: AAI, contratos, facturas, registros, excels de costes del cliente
Quién puede leerlo: SOLO ese proyecto/cliente
Quién puede escribirlo: el consultor cuando sube documentos del cliente
Caso de uso: "¿Cuánto pagó este cliente por LER 120101 en 2023?" →
              busca en RAG del proyecto
```

### El routing es automático

```python
# DocumentIngestionRouter decide el scope según tipo de documento:
"normativa" → general
"bref" → general
"autorizacion_ambiental_integrada" → project
"contrato_gestor" → project
"factura" → project
"costes_anuales" (Excel) → project
```

### Las búsquedas siempre combinan ambas capas

```python
# El contexto que llega al LLM está etiquetado:
"""
DOCUMENTOS DEL CLIENTE (datos reales del proyecto):
[CONTRATO | contrato_gestora_xyz.pdf | Relevancia: 0.91]
... texto del contrato ...

BASE DE CONOCIMIENTO GENERAL (normativa y benchmarks):
[NORMATIVA | Ley 7/2022 art. 26 | Relevancia: 0.87]
... artículo de la ley ...
"""
# El LLM sabe distinguir qué es normativa vs qué son datos reales del cliente
```

---

## PIPELINE DE PROCESAMIENTO DE DOCUMENTOS

### Flujo completo (pdf_pipeline.py → unified_ingestion.py)

```
ARCHIVO SUBIDO (PDF, Excel, CSV)
         │
         ▼
UnifiedIngestionService.ingest()
         │
         ├─ Si PDF → PDFPipeline.process()
         │           │
         │           ├── 1. PDFNatureDetector → digital/scanned/hybrid/encrypted?
         │           ├── 2. ContentExtractorImpl → texto + tablas (OCR si necesario)
         │           ├── 3. DocumentClassifier → AAI/contrato/factura/registro...
         │           ├── 4. SemanticChunker → chunks respetando estructura
         │           ├── 5. EmbeddingService → OpenAI embeddings batch
         │           ├── 6. MetadataExtractor → LERs, precios, fechas, gestores
         │           └── 7. StorageService → Supabase + Drive
         │
         └─ Si Excel/CSV → ExcelProcessor.process()
                         │
                         ├── 1. Leer hojas (detección automática de cabeceras)
                         ├── 2. Clasificar tipo de hoja (costes/inventario/registro...)
                         ├── 3. Extraer LERs, fechas, importes
                         ├── 4. Generar texto contextualizado (tabla markdown + resumen LLM)
                         ├── 5. Generar chunks (1 chunk/hoja si <100 filas, bloques si más)
                         ├── 6. EmbeddingService → embeddings
                         └── 7. Poblar waste_inventory + invoice_lines en Supabase
         │
         ▼
DocumentIngestionRouter.route() → determina rag_scope
         │
         ▼
Supabase: client_documents + document_chunks (con embedding + rag_scope)
Google Drive: carpeta correcta según cliente + tipo de documento
```

### Pasos del pipeline y su progreso en UI

```
"iniciando" → 0%
"detectando_tipo" → 5%
"extrayendo_contenido" → 15%
"clasificando_documento" → 35%
"fragmentando" → 45%
"generando_embeddings" → 60%
"extrayendo_metadatos" → 75%
"almacenando" → 85%
"completado" → 100%
```

El progreso se emite via `pipeline_progress` table con Supabase Realtime
→ la UI puede mostrar una barra de progreso en tiempo real.

### Casos especiales manejados

**PDFs escaneados**: Tesseract OCR con preprocesamiento (contraste, nitidez, binarización).
DPI 300. Idioma: spa+eng. Confianza mínima 0.6 — si baja, genera advertencia.

**PDFs muy largos** (AAIs de 80-200 páginas): chunking semántico por secciones
detectadas (CAPÍTULO, CONDICIÓN, Artículo) en vez de ventana deslizante ciega.
Las secciones largas se subdividen con overlap de 200 tokens.

**PDFs encriptados**: pikepdf intenta desencriptar automáticamente sin contraseña
(cubre ~60% de casos con solo restricciones de copia). Si falla, solicita contraseña.
El archivo original encriptado se conserva.

**Tablas en AAIs**: pdfplumber con `vertical_strategy: "lines"` extrae tablas de LERs
autorizados. Se convierten a markdown y se guardan como chunks separados de tipo "tabla".

**Excel con cabeceras desplazadas**: detección automática de la fila de cabeceras
(muchos excels industriales tienen logos y títulos en las primeras filas).

---

## AGENTES IA (LangGraph — PRÓXIMA FASE A IMPLEMENTAR)

### Estado compartido entre agentes

```python
class ClientAnalysisState(TypedDict):
    client_id: str
    project_id: str
    documents: list[Document]           # documentos subidos
    doc_types: dict                     # clasificación de cada doc
    aai_findings: list[Finding]         # output AgenteAAI
    contract_findings: list[Finding]    # output AgenteContratos
    invoice_findings: list[Finding]     # output AgenteFacturas
    registry_findings: list[Finding]    # output AgenteRegistro
    compliance_issues: list[Issue]      # output AgenteNormativo
    opportunities: list[Opportunity]    # output AgenteOptimizador (priorizado €/año)
    report: Report                      # output AgenteRedactor
    errors: list[str]
```

### Grafo de ejecución

```python
graph.add_node("classify_docs", classify_documents)
graph.add_node("agent_aai", analyze_aai)
graph.add_node("agent_contracts", analyze_contracts)
graph.add_node("agent_invoices", analyze_invoices)
graph.add_node("agent_registry", analyze_registry)
graph.add_node("agent_normative", check_compliance)  # espera a AAI
graph.add_node("optimizer", generate_opportunities)   # espera a todos
graph.add_node("reporter", generate_report)

# Paralelo real
graph.add_edge("classify_docs", ["agent_aai", "agent_contracts",
                                  "agent_invoices", "agent_registry"])
graph.add_edge("agent_aai", "agent_normative")
graph.add_edge(["agent_normative", "agent_contracts",
                "agent_invoices", "agent_registry"], "optimizer")
graph.add_edge("optimizer", "reporter")
```

### Qué hace cada agente

**AgenteAAI**: Lee la AAI del cliente y extrae LERs autorizados + cantidades máximas.
Detecta si hay residuos generados que superen los límites autorizados.
Output: lista de incumplimientos y condiciones relevantes.

**AgenteContratos**: Lee contratos con gestores. Extrae precios €/t por LER,
fechas de vencimiento, cláusulas de penalización. Compara precios vs tabla
waste_managers (benchmarks de mercado). Output: sobrecoste detectado por LER.

**AgenteFacturas**: Analiza histórico de facturas. Detecta desviaciones precio
contratado vs facturado, recogidas innecesarias, residuos en facturas no declarados.
Output: anomalías financieras con importe.

**AgenteRegistro**: Analiza libro de registro. Detecta residuos peligrosos
almacenados más de 6 meses (ilegal), tendencias de generación, coherencia con DARI.
Output: incumplimientos de plazos + alertas urgentes.

**AgenteNormativo**: Con el perfil del cliente (sector + CCAA + LERs) hace RAG
en la capa general para identificar obligaciones aplicables y cambios normativos
recientes. Output: obligaciones incumplidas o en riesgo.

**AgenteOptimizador**: Recibe todos los findings anteriores y genera lista de
oportunidades priorizadas por €/año de ahorro, con validación legal de cada propuesta.

**AgenteRedactor**: Genera informe ejecutivo estructurado listo para entregar al cliente.

---

## ESTRUCTURA DE CARPETAS EN GOOGLE DRIVE (auto-creada)

```
RAG_Residuos_Industriales/
├── Clientes/
│   ├── {Nombre Cliente 1}/
│   │   ├── AAI_Autorizaciones/
│   │   ├── DARI_Declaraciones/
│   │   ├── Contratos_Gestores/
│   │   ├── Facturas/
│   │   ├── Registros_Produccion/
│   │   └── _Sin_Clasificar/
│   └── {Nombre Cliente 2}/
│       └── ...
└── Normativa/
    ├── Europea/
    ├── Nacional/
    └── Autonomica/
        ├── Cataluña/
        ├── Madrid/
        └── ...
```

---

## VARIABLES DE ENTORNO NECESARIAS

```bash
# IA
ANTHROPIC_API_KEY=sk-ant-...
OPENAI_API_KEY=sk-...

# Base de datos
SUPABASE_URL=https://xxx.supabase.co
SUPABASE_SERVICE_KEY=eyJ...         # service role key (solo backend)
SUPABASE_ANON_KEY=eyJ...            # anon key (frontend)

# Google Drive
GOOGLE_DRIVE_CREDENTIALS_PATH=credentials.json   # service account JSON

# LangSmith (observabilidad agentes)
LANGSMITH_API_KEY=...
LANGCHAIN_TRACING_V2=true
LANGCHAIN_PROJECT=residuos-ia-pro
```

---

## CONTEXTO DE NEGOCIO IMPORTANTE

### Tipos de residuos industriales que maneja el consultor

Los códigos LER (Lista Europea de Residuos) son de 6 dígitos (ej: 12 01 01).
Los residuos peligrosos llevan asterisco (ej: 16 06 01*).
Los primeros dos dígitos indican el sector generador (12 = tratamiento de metales,
15 = envases y embalajes, 20 = residuos municipales, etc.)

### Operaciones de gestión
- **D1-D15**: operaciones de eliminación (vertedero, incineración sin recuperación)
- **R1-R13**: operaciones de valorización (reciclaje, recuperación energética)
La ley española obliga a priorizar R sobre D siempre que sea técnica y económicamente viable.

### Marco regulatorio clave
- **Ley 7/2022**: norma troncal española (transpone directivas europeas 2018)
- **Directiva 2008/98/CE + modificación 2018/851/UE**: marco europeo
- **Ley 16/2002 / RDL 1/2016**: IPPC, autorizaciones ambientales integradas
- **Cada CCAA** tiene su propia normativa y registro de productores/gestores
- **DARI**: declaración anual obligatoria de residuos industriales

### El argumento comercial que usa el consultor con sus clientes
"Analizamos tus documentos y detectamos que estás pagando X€/año por gestión
de residuos. Podemos reducirlo a Y€/año. La diferencia paga nuestros honorarios
con ROI claro desde el primer año."

---

## TAREAS PENDIENTES (orden de implementación sugerido)

### FASE 1 — Hacer funcionar el pipeline (esta semana)

1. **Instalar dependencias del sistema**:
   ```bash
   # macOS
   brew install tesseract tesseract-lang poppler
   pip install -r requirements.txt

   # Ubuntu
   sudo apt-get install tesseract-ocr tesseract-ocr-spa poppler-utils
   pip install -r requirements.txt
   ```

2. **Ejecutar schema en Supabase**:
   - Primero `config/schema.sql`
   - Luego `config/schema_scoping.sql`
   - Verificar que la extensión `vector` está activa

3. **Test del pipeline con un PDF real**:
   ```python
   # Probar con una AAI o contrato real
   from core.pdf_pipeline import PDFPipeline
   from config.config import PipelineConfigImpl
   # ... (ver README.md para el código completo)
   ```

4. **Crear Edge Function de Supabase** (`/ingest`) que:
   - Recibe multipart/form-data (archivo + metadatos)
   - Llama al UnifiedIngestionService
   - Retorna IngestionResult como JSON

### FASE 2 — UI básica funcional

5. **Next.js con estas páginas mínimas**:
   - `/dashboard` — lista de clientes con semáforo de cumplimiento
   - `/client/[id]` — ficha con inventario + documentos + alertas
   - `/client/[id]/upload` — drag & drop con barra de progreso Realtime

6. **Conectar Supabase Realtime** a la UI de subida para mostrar progreso

### FASE 3 — Motor de análisis IA

7. **Implementar LangGraph** con AgenteAAI como primer agente
8. **Añadir AgenteContratos** y cruzarlo con AgenteAAI
9. **AgenteOptimizador** que genere opportunities en Supabase
10. **Edge Function `/analyze-client`** que lance el grafo LangGraph

### FASE 4 — Completar la plataforma

11. Monitor de cumplimiento con calendario de obligaciones
12. Generador de informes PDF
13. Asistente IA (chat RAG) en la UI
14. Dashboard de analytics del negocio del consultor

---

## DECISIONES DE DISEÑO IMPORTANTES (no cambiar sin razón)

1. **Un solo punto de entrada de ingesta** (`unified_ingestion.py`). No crear
   rutas separadas para PDF vs Excel — el router interno gestiona la diferencia.

2. **El rag_scope se detecta automáticamente**. El consultor NO tiene que elegir
   "general" o "project" manualmente. Solo documentos de normativa van a general.

3. **Los metadatos estructurados van a dos sitios**: a `client_documents.metadata`
   (JSONB flexible) Y a tablas estructuradas (`waste_inventory`, `invoice_lines`).
   Las tablas estructuradas son para que los agentes hagan SQL directo sin RAG.

4. **El contexto RAG siempre está etiquetado** por scope antes de pasarlo al LLM.
   El LLM nunca ve chunks mezclados sin saber si son normativa o datos del cliente.

5. **LangGraph, no CrewAI ni AutoGen**. La complejidad del flujo (paralelo + esperas
   + estado compartido) requiere control explícito del grafo.

6. **Claude Haiku para clasificación y metadatos** (rápido y barato),
   **Claude Sonnet para análisis y generación** (calidad máxima).

---

## COMANDO INICIAL PARA EMPEZAR

```bash
# 1. Clonar repo y entrar al directorio
cd residuos_pdf_pipeline

# 2. Crear entorno virtual
python -m venv venv && source venv/bin/activate

# 3. Instalar dependencias
pip install -r requirements.txt

# 4. Copiar y rellenar .env
cp .env.example .env  # crear este archivo con las variables de arriba

# 5. Ejecutar tests del pipeline
python -c "
import asyncio
from core.pdf_pipeline import PDFPipeline
from config.config import PipelineConfigImpl
import os

config = PipelineConfigImpl(
    anthropic_api_key=os.getenv('ANTHROPIC_API_KEY'),
    openai_api_key=os.getenv('OPENAI_API_KEY'),
    supabase_url=os.getenv('SUPABASE_URL'),
    supabase_service_key=os.getenv('SUPABASE_SERVICE_KEY'),
)
print('Config OK:', config)
"
```

---

## PREGUNTAS FRECUENTES QUE PUEDE HACER EL CONSULTOR (usuario)

**"¿Qué obligaciones tiene mi cliente X en Cataluña con residuos peligrosos?"**
→ RAG sobre normativa general (CCAA Cataluña) + RAG sobre su AAI (proyecto)

**"¿Está pagando de más por la gestión del LER 120101?"**
→ Query SQL en waste_inventory del cliente + comparar con waste_managers (benchmarks)

**"¿Hay algún incumplimiento en el registro de producción?"**
→ AgenteRegistro analiza registry_findings y detecta almacenamientos >6 meses

**"Genera el informe de diagnóstico inicial de este cliente"**
→ Lanza el grafo LangGraph completo → AgenteRedactor genera el PDF

**"¿Cuánto hemos ahorrado para este cliente este año?"**
→ Query SQL en savings_opportunities WHERE estado='implementada' AND client_id=X

---

*Este documento contiene todo el contexto necesario para continuar el desarrollo.
Ante cualquier duda de diseño, consultar las decisiones en la sección correspondiente
antes de implementar alternativas.*
