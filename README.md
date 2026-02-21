# Pipeline de Procesamiento de PDFs — ResidusIA Pro

## El problema que resuelve

Los PDFs de gestión de residuos industriales son los más difíciles de procesar:
- Las **AAIs** son documentos oficiales escaneados de 80-200 páginas con tablas de LERs
- Los **contratos** tienen cláusulas en prosa y tablas de precios mixtas  
- Las **facturas** pueden venir de 20 gestores distintos, cada uno con su formato
- Los **registros** son formularios semiestructurados con firmas y sellos
- El **40% llegan encriptados** o con restricciones de copia

Este pipeline maneja todos estos casos automáticamente.

## Flujo completo

```
PDF (cualquier tipo)
        │
        ▼
┌───────────────────┐
│  DETECCIÓN        │  ¿Digital? ¿Escaneado? ¿Encriptado? ¿Híbrido?
└────────┬──────────┘
         │
         ▼
┌───────────────────┐
│  DESENCRIPTADO    │  pikepdf — intento automático sin contraseña
└────────┬──────────┘  Si falla → solicita contraseña al usuario
         │
         ▼
┌───────────────────┐
│  EXTRACCIÓN       │  pdfplumber (digital) / Tesseract OCR (escaneado)
│  TEXTO + TABLAS   │  Las tablas se extraen como markdown estructurado
└────────┬──────────┘
         │
         ▼
┌───────────────────┐
│  CLASIFICACIÓN    │  Regex → señales de contenido → Claude (fallback)
│  DEL TIPO         │  AAI / Contrato / Factura / Registro / DARI
└────────┬──────────┘
         │
         ▼
┌───────────────────┐
│  CHUNKING         │  Semántico: respeta secciones, cláusulas, entradas
│  SEMÁNTICO        │  Estrategia diferente por tipo de documento
└────────┬──────────┘
         │
         ▼
┌───────────────────┐
│  EMBEDDINGS       │  OpenAI text-embedding-3-large en lotes de 50
└────────┬──────────┘
         │
         ▼
┌───────────────────┐
│  EXTRACCIÓN DE    │  Claude extrae: LERs, precios €/t, fechas vencimiento,
│  METADATOS        │  nombre gestor, condiciones AAI, alertas cumplimiento
└────────┬──────────┘
         │
         ▼
┌───────────────────┐
│  ALMACENAMIENTO   │  Drive: carpeta correcta por cliente + tipo
│  Drive + Supabase │  Supabase: document_chunks con pgvector
└───────────────────┘  + pobla tablas estructuradas (contratos, facturas...)
```

## Instalación

```bash
# 1. Instalar dependencias del sistema
# macOS:
brew install tesseract tesseract-lang poppler

# Ubuntu/Debian:
sudo apt-get install tesseract-ocr tesseract-ocr-spa poppler-utils

# 2. Instalar dependencias Python
pip install -r requirements.txt

# 3. Configurar variables de entorno
cp .env.example .env
# Editar .env con tus claves
```

## Variables de entorno (.env)

```
ANTHROPIC_API_KEY=sk-ant-...
OPENAI_API_KEY=sk-...
SUPABASE_URL=https://xxx.supabase.co
SUPABASE_SERVICE_KEY=eyJ...
GOOGLE_DRIVE_CREDENTIALS_PATH=credentials.json
```

## Uso básico

```python
from core.pdf_pipeline import PDFPipeline
from config.config import PipelineConfigImpl
import asyncio

config = PipelineConfigImpl(
    anthropic_api_key="sk-ant-...",
    openai_api_key="sk-...",
    supabase_url="https://xxx.supabase.co",
    supabase_service_key="eyJ...",
)

pipeline = PDFPipeline(config)

async def process_document():
    with open("aai_cliente_aceros_sl.pdf", "rb") as f:
        pdf_bytes = f.read()

    result = await pipeline.process(
        pdf_bytes=pdf_bytes,
        client_id="uuid-del-cliente",
        filename="aai_cliente_aceros_sl.pdf",
        drive_upload=True,
    )

    print(f"Tipo detectado: {result.doc_type}")
    print(f"Páginas: {result.total_pages}")
    print(f"Chunks: {len(result.chunks)}")
    print(f"LERs encontrados: {result.metadata.get('ler_codes_found')}")
    print(f"Advertencias: {result.extraction_warnings}")

asyncio.run(process_document())
```

## Estructura de carpetas en Drive (auto-creada)

```
RAG_Residuos_Industriales/
├── Clientes/
│   ├── Aceros Mediterráneo SL/
│   │   ├── AAI_Autorizaciones/
│   │   ├── Contratos_Gestores/
│   │   ├── Facturas/
│   │   ├── Registros_Produccion/
│   │   └── DARI_Declaraciones/
│   └── Química Industrial SA/
│       └── ...
└── Normativa/
    ├── Europea/
    ├── Nacional/
    └── Autonomica/
```

## Casos especiales manejados

### PDFs escaneados con baja calidad
El preprocesamiento de imagen aplica:
1. Conversión a escala de grises
2. Aumento de contraste (×2)
3. Filtro de nitidez
4. Binarización adaptativa
5. DPI 300 para la conversión

### PDFs muy largos (AAIs de 200 páginas)
- Chunking por secciones detectadas (no por tokens ciegos)
- Las secciones demasiado largas se subdividen con ventana deslizante
- Las tablas se extraen como chunks separados con formato markdown

### PDFs encriptados
1. Intento automático de desencriptado sin contraseña (cubre ~60% de los casos)
2. Si falla → solicita contraseña vía UI (campo en el formulario de subida)
3. El original encriptado se conserva; se procesa la versión desencriptada

### Tablas en documentos oficiales
Las tablas de las AAIs (lista de LERs autorizados con cantidades) se extraen con:
- `vertical_strategy: "lines"` y `horizontal_strategy: "lines"` de pdfplumber
- Se convierten a formato markdown para mejor comprensión del LLM
- Se guardan como chunks independientes de tipo "tabla"

## Qué se guarda en Supabase

| Tabla | Contenido |
|---|---|
| `client_documents` | Un registro por PDF procesado con todos los metadatos |
| `document_chunks` | Fragmentos con embeddings para RAG semántico |
| `invoice_lines` | Líneas de factura para tracking financiero |
| `compliance_alerts` | Alertas de cumplimiento detectadas automáticamente |
| `pipeline_progress` | Progreso en tiempo real (Supabase Realtime → UI) |

## Integración con LangGraph (agentes)

Los agentes del sistema multiagente usan este pipeline así:

```python
# En el AgenteAAI de LangGraph:
async def analyze_aai(state: ClientAnalysisState):
    doc = state.documents["aai"]  # ya procesado por el pipeline
    
    # Los chunks ya están en Supabase con embeddings
    # El agente hace RAG sobre ellos directamente
    chunks = await search_chunks(
        query_embedding=await embed("límites LER autorizados"),
        client_id_filter=state.client_id,
        doc_type_filter="autorizacion_ambiental_integrada",
    )
    # ... analizar chunks y generar findings
```
