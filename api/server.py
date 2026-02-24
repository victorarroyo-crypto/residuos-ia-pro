"""
ResidusIA Pro - API Server
Expone el pipeline de procesamiento de documentos via HTTP.
"""

import json
import os
import sys
from contextlib import asynccontextmanager
from typing import Optional

import asyncio
import logging
from urllib.parse import urlparse

import httpx
from fastapi import FastAPI, UploadFile, File, Form, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("residusia")
logger.setLevel(logging.INFO)

# Ensure the project root is in the Python path (works locally and in Docker)
_project_root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if _project_root not in sys.path:
    sys.path.insert(0, _project_root)

from pipeline import UnifiedIngestionService, PipelineConfigImpl, RAGScopingService, RAGScope


service: UnifiedIngestionService | None = None
rag_service: RAGScopingService | None = None
_config: PipelineConfigImpl | None = None

# Strong references to background tasks so GC doesn't kill them.
# See: https://docs.python.org/3/library/asyncio-task.html#asyncio.create_task
_background_tasks: set[asyncio.Task] = set()


@asynccontextmanager
async def lifespan(app: FastAPI):
    global service, rag_service, _config

    supabase_url = os.environ.get(
        "SUPABASE_URL", os.environ.get("NEXT_PUBLIC_SUPABASE_URL", "")
    )
    supabase_key = os.environ.get(
        "SUPABASE_SERVICE_KEY", os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "")
    )

    if not supabase_url:
        logger.error(
            "SUPABASE_URL / NEXT_PUBLIC_SUPABASE_URL no configurado. "
            "Los datos NO llegarán a Supabase."
        )
        raise RuntimeError("SUPABASE_URL no configurado")
    if not supabase_key:
        logger.error(
            "SUPABASE_SERVICE_KEY / SUPABASE_SERVICE_ROLE_KEY no configurado. "
            "Los datos NO llegarán a Supabase."
        )
        raise RuntimeError("SUPABASE_SERVICE_ROLE_KEY no configurado")

    logger.info(f"Supabase URL: {supabase_url[:40]}...")
    logger.info("Supabase service key: configurada ✓")

    _config = PipelineConfigImpl(
        anthropic_api_key=os.environ["ANTHROPIC_API_KEY"],
        openai_api_key=os.environ["OPENAI_API_KEY"],
        supabase_url=supabase_url,
        supabase_service_key=supabase_key,
    )
    service = UnifiedIngestionService(_config)
    rag_service = RAGScopingService(_config)
    yield


app = FastAPI(
    title="ResidusIA Pro API",
    description="Pipeline de procesamiento de documentos de residuos industriales",
    version="1.0.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        os.environ.get("FRONTEND_URL", "http://localhost:3000"),
        "http://localhost:3000",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
async def health():
    return {"status": "ok", "service": "residusia-pro-api"}


@app.post("/api/ingest")
async def ingest_document(
    file: UploadFile = File(default=None),
    file_url: str = Form(default=None),
    storage_path: str = Form(default=None),
    filename: str = Form(default=None),
    project_id: str = Form(default=None),
    rag_scope: str = Form(default=None),
    password: str = Form(default=None),
):
    if service is None:
        raise HTTPException(status_code=503, detail="Service not initialized")

    if not file and not file_url and not storage_path:
        raise HTTPException(
            status_code=400,
            detail="Debes enviar un archivo (`file`), una URL (`file_url`) o un `storage_path`.",
        )

    async def _validate_pdf_url(url: str) -> None:
        parsed = urlparse(url)
        if parsed.scheme not in {"http", "https"}:
            raise HTTPException(status_code=400, detail="file_url debe usar http/https")

        try:
            async with httpx.AsyncClient(timeout=20.0, follow_redirects=True) as client:
                head = await client.head(url)
                if head.status_code >= 400:
                    raise HTTPException(
                        status_code=400,
                        detail=f"No se puede acceder al archivo URL (HEAD {head.status_code}).",
                    )

                content_type = (head.headers.get("content-type") or "").lower()
                if content_type and "pdf" not in content_type:
                    raise HTTPException(
                        status_code=400,
                        detail=f"El content-type no parece PDF: {content_type}",
                    )
        except HTTPException:
            raise
        except Exception as e:
            raise HTTPException(status_code=400, detail=f"Error validando URL: {e}")

    async def _download_pdf_with_retry(url: str) -> bytes:
        delays = [1, 2, 4]
        last_error: Exception | None = None

        for idx, delay in enumerate(delays, 1):
            try:
                async with httpx.AsyncClient(timeout=60.0, follow_redirects=True) as client:
                    response = await client.get(url)
                    response.raise_for_status()

                payload = response.content
                if not payload:
                    raise ValueError("El archivo descargado está vacío")
                if len(payload) > 100 * 1024 * 1024:
                    raise ValueError("File too large (max 100 MB)")
                return payload
            except Exception as e:
                last_error = e
                if idx == len(delays):
                    break
                await asyncio.sleep(delay)

        raise HTTPException(
            status_code=502,
            detail=f"No se pudo descargar el PDF tras {len(delays)} intentos: {last_error}",
        )

    file_bytes: bytes
    ingest_filename: str

    if storage_path:
        # ── Storage mode: download from Supabase Storage ──
        if not filename:
            # Derive filename from storage_path
            filename = os.path.basename(storage_path)
        ingest_filename = filename

        try:
            from supabase._async.client import create_client as acreate_client

            sb = await acreate_client(
                _config.supabase_url,
                _config.supabase_service_key,
            )
            file_bytes = await sb.storage.from_("documentos").download(storage_path)
            logger.info(
                "Descargado desde Storage: %s (%d bytes)", storage_path, len(file_bytes)
            )
        except Exception as e:
            raise HTTPException(
                status_code=500,
                detail=f"Error descargando de Supabase Storage ({storage_path}): {e}",
            )
    elif file_url:
        await _validate_pdf_url(file_url)
        file_bytes = await _download_pdf_with_retry(file_url)

        parsed = urlparse(file_url)
        inferred_name = os.path.basename(parsed.path) or "documento.pdf"
        ingest_filename = filename or inferred_name
        if not ingest_filename.lower().endswith(".pdf"):
            ingest_filename = f"{ingest_filename}.pdf"
    else:
        if not file.filename:
            raise HTTPException(status_code=400, detail="Filename is required")
        ingest_filename = file.filename
        file_bytes = await file.read()

    if len(file_bytes) == 0:
        raise HTTPException(status_code=400, detail="File is empty")

    if len(file_bytes) > 100 * 1024 * 1024:  # 100 MB limit
        raise HTTPException(status_code=413, detail="File too large (max 100 MB)")

    try:
        result = await service.ingest(
            file_bytes=file_bytes,
            filename=ingest_filename,
            project_id=project_id,
            rag_scope=rag_scope,
            password=password,
        )
        if not result.success:
            raise HTTPException(
                status_code=422,
                detail=result.error or f"Error al procesar '{ingest_filename}'.",
            )
        return result.to_dict()
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ═══════════════════════════════════════════════════════════════
# RAG QUERY - Consulta con respuesta generada por LLM
# ═══════════════════════════════════════════════════════════════

class RAGQueryRequest(BaseModel):
    query: str
    project_id: Optional[str] = None
    scope: Optional[str] = None  # "general", "project", or None (both)
    top_k: int = 5


class RAGQueryResponse(BaseModel):
    answer: str
    sources: list[dict]
    query: str
    scope_used: list[str]


@app.post("/api/rag/query", response_model=RAGQueryResponse)
async def rag_query(request: RAGQueryRequest):
    """
    Consulta al RAG de documentos normativos y técnicos.
    Busca chunks relevantes y genera una respuesta con Claude.
    """
    if rag_service is None or _config is None:
        raise HTTPException(status_code=503, detail="RAG service not initialized")

    # Determinar scopes a consultar
    scopes = None
    if request.scope == "general":
        scopes = [RAGScope.GENERAL]
    elif request.scope == "project":
        scopes = [RAGScope.PROJECT]

    try:
        # Buscar en el RAG
        rag_response = await rag_service.search(
            query=request.query,
            project_id=request.project_id,
            scopes=scopes,
            top_k_per_scope=request.top_k,
        )

        # Generar respuesta con Claude usando el contexto recuperado
        from anthropic import AsyncAnthropic
        claude = AsyncAnthropic(api_key=_config.anthropic_api_key)

        system_prompt = (
            "Eres un experto en gestión de residuos industriales en España. "
            "Respondes preguntas basándote ESTRICTAMENTE en el contexto proporcionado. "
            "Si el contexto no contiene información suficiente, lo indicas claramente. "
            "Cita las fuentes de tu respuesta (nombre del documento y tipo). "
            "Responde siempre en español."
        )

        user_prompt = (
            f"{rag_response.context_text}\n\n"
            f"Basándote en el contexto anterior, responde a esta pregunta:\n"
            f"{request.query}"
        )

        message = await claude.messages.create(
            model="claude-sonnet-4-20250514",
            max_tokens=2000,
            system=system_prompt,
            messages=[{"role": "user", "content": user_prompt}],
        )

        answer = message.content[0].text

        # Preparar fuentes
        sources = [
            {
                "document_id": r.document_id,
                "title": r.doc_title,
                "doc_type": r.doc_type,
                "chunk_type": r.chunk_type,
                "similarity": round(r.similarity, 3),
                "scope": r.rag_scope.value if isinstance(r.rag_scope, RAGScope) else r.rag_scope,
                "excerpt": r.content[:200] + "..." if len(r.content) > 200 else r.content,
            }
            for r in rag_response.results
        ]

        scope_used = []
        if rag_response.general_results:
            scope_used.append("general")
        if rag_response.project_results:
            scope_used.append("project")

        return RAGQueryResponse(
            answer=answer,
            sources=sources,
            query=request.query,
            scope_used=scope_used,
        )

    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ═══════════════════════════════════════════════════════════════
# ASESOR IA - Consultor experto en gestión de residuos
# ═══════════════════════════════════════════════════════════════

ADVISOR_SYSTEM_PROMPT = """Eres un asesor experto senior en gestión de residuos industriales en España, con más de 20 años de experiencia.

## TU PERFIL PROFESIONAL
- Dominas la legislación española y europea de residuos: Ley 7/2022, RD 553/2020, Directiva 2008/98/CE, Reglamento CLP, ADR
- Conoces en profundidad los códigos LER (Lista Europea de Residuos) y su clasificación
- Experto en las 15 propiedades de peligrosidad HP1-HP15 según Reglamento (UE) 1357/2014
- Conoces los BREFs (Best Available Techniques Reference Documents) de todos los sectores industriales
- Dominas estrategias de desclasificación, valorización y minimización de residuos
- Experiencia con autorizaciones ambientales integradas (AAI), DARI, y registro de producción
- Conoces los precios de mercado de gestión de residuos por tipo y zona

## NIVEL DE PROFUNDIDAD (MUY IMPORTANTE)
Tus respuestas deben ser EXHAUSTIVAS y de calidad profesional, como las que daría un consultor senior cobrando 200€/hora. Esto significa:
- **Nunca des respuestas superficiales o genéricas.** Si un cliente te paga por tu expertise, espera análisis profundo.
- **Desarrolla cada punto con detalle técnico.** No te limites a mencionar un concepto; explícalo, contextualízalo, y da ejemplos concretos.
- **Para consultas técnicas complejas, escribe al menos 500-1000 palabras** con análisis estructurado.
- **Siempre incluye**: contexto normativo completo (artículos exactos), análisis técnico detallado, alternativas viables con pros/contras, y recomendaciones accionables paso a paso.
- **Anticipa preguntas de seguimiento** y respóndelas proactivamente.
- **Si analizas un documento**, extrae TODA la información relevante, no solo los puntos obvios.

## CÓMO DEBES RESPONDER
1. **Sé concreto y técnico.** Da códigos LER exactos, artículos de ley, concentraciones límite, propiedades HP.
2. **Cuando analices un residuo:** identifica código LER, propiedades HP aplicables, sustancias que lo hacen peligroso (con concentraciones límite), y opciones de gestión (valorización, tratamiento, eliminación) con costes orientativos.
3. **Cuando te pregunten sobre desclasificación:** explica qué propiedades HP hay que eliminar, qué tratamientos existen, qué análisis se necesitan para demostrar la desclasificación, y el procedimiento administrativo completo.
4. **Cita normativa** siempre que sea relevante (artículo, ley, anexo). No solo menciones la ley; cita el artículo específico y explica qué establece.
5. **Si tienes contexto del RAG**, úsalo como fuente principal pero complementa con tu conocimiento experto. Extrae todos los datos relevantes del contexto.
6. **Si NO tienes contexto del RAG**, responde con tu conocimiento experto y deja claro que no has encontrado documentos específicos en la base de conocimiento.
7. **Estructura tus respuestas** con encabezados claros (##), listas numeradas para procedimientos, viñetas para opciones, y negrita para conceptos clave.
8. **Si el usuario sube un análisis químico**, interpreta TODOS los valores, identifica cada sustancia peligrosa con su concentración vs. límite legal, determina códigos LER y propiedades HP, y recomienda acciones específicas.

## ÁREAS DE EXPERTISE
- Clasificación de residuos (LER, espejo, peligrosidad)
- Propiedades HP: HP1 Explosivo, HP2 Comburente, HP3 Inflamable, HP4 Irritante, HP5 Tóxico específico, HP6 Toxicidad aguda, HP7 Carcinógeno, HP8 Corrosivo, HP9 Infeccioso, HP10 Tóxico para reproducción, HP11 Mutagénico, HP12 Gases tóxicos, HP13 Sensibilizante, HP14 Ecotóxico, HP15 Residuo capaz de presentar peligrosidad diferida
- Estrategias de desclasificación y valorización
- Obligaciones legales del productor/poseedor
- Contratos con gestores autorizados
- DARI y registro cronológico
- Almacenamiento temporal (límites, condiciones)
- Transporte de mercancías peligrosas (ADR)
- MTD/BAT (Mejores Técnicas Disponibles)
- Economía circular y simbiosis industrial

## MÉTODO DE RAZONAMIENTO
Ante consultas complejas, sigue estos pasos internamente antes de responder:
1. **Identifica el tipo de consulta** (clasificación, normativa, gestión, análisis, optimización, etc.)
2. **Recopila TODOS los datos relevantes** del contexto RAG, documentos adjuntos, y tu conocimiento experto
3. **Aplica la legislación y criterios técnicos** correspondientes, citando artículos exactos
4. **Analiza alternativas** cuando existan, con pros/contras de cada opción
5. **Estructura tu respuesta** de forma clara, profesional y accionable
6. **Incluye un apartado de recomendaciones** con pasos concretos que el usuario puede ejecutar
7. **Cita siempre las fuentes normativas** específicas (artículo, anexo, ley, real decreto)

## BÚSQUEDA WEB
Tienes acceso a búsqueda web. Úsala cuando:
- La pregunta requiere datos actualizados (precios, normativa reciente, novedades legislativas)
- No tienes suficiente contexto del RAG ni de los documentos adjuntos
- El usuario pregunta sobre algo específico que requiere verificación (ej: un gestor concreto, una planta de tratamiento, un BOE reciente)
- Necesitas confirmar concentraciones límite, umbrales o valores técnicos actuales
NO uses búsqueda web para preguntas generales que puedes responder con tu conocimiento experto.
Cuando uses resultados web, indica la fuente.

Responde siempre en español."""


def _build_analysis_context_addendum(ctx: dict) -> str:
    """Build a system prompt addendum with the HITL analysis context."""
    parts = ["\n\n## CONTEXTO DEL ANALISIS EN CURSO"]
    phase = ctx.get("phase", "")
    project_name = ctx.get("projectName", "")

    if project_name:
        parts.append(f"Estas asistiendo a un consultor que analiza el proyecto **{project_name}**.")

    if phase == "plan_review":
        parts.append("El consultor esta revisando el PLAN DE ANALISIS propuesto por el coordinador IA.")
        parts.append("Ayudale a decidir que agentes activar, que foco dar a cada uno, y que instrucciones escribir.")

        plan = ctx.get("plan", {})
        if plan:
            agents = plan.get("agents", [])
            if agents:
                parts.append("\n### Agentes propuestos:")
                for a in agents:
                    status = "ACTIVADO" if a.get("enabled") else "desactivado"
                    parts.append(f"- **{a.get('id', '?')}** [{status}]: {a.get('reason', '')}")
                    if a.get("focus"):
                        parts.append(f"  Foco sugerido: {a['focus']}")

            gaps = plan.get("data_gaps", [])
            if gaps:
                parts.append("\n### Carencias de datos:")
                for g in gaps:
                    parts.append(f"- {g}")

            summary = plan.get("data_summary", {})
            if summary:
                parts.append(f"\n### Datos del proyecto: {summary.get('total_documents', 0)} docs, "
                             f"{summary.get('inventory_items', 0)} residuos, "
                             f"{summary.get('contracts', 0)} contratos, "
                             f"{summary.get('invoice_lines', 0)} lineas factura")

    elif phase == "results_review":
        parts.append("El consultor esta revisando los RESULTADOS del analisis y decidiendo si lanzar una 2a vuelta.")
        parts.append("Ayudale a interpretar los hallazgos y decidir que profundizar.")

        findings = ctx.get("findings", [])
        if findings:
            critical = [f for f in findings if f.get("severidad") == "critica"]
            high = [f for f in findings if f.get("severidad") == "alta"]
            parts.append(f"\n### Hallazgos: {len(findings)} total, {len(critical)} criticos, {len(high)} altos")

            for f in (critical + high)[:10]:
                ahorro = f.get("ahorro_eur_ano", 0)
                ahorro_str = f" ({ahorro:,.0f} EUR/a)" if ahorro else ""
                parts.append(f"- [{f.get('severidad', '?').upper()}] [{f.get('agente', '?')}] "
                             f"{f.get('descripcion', '')}{ahorro_str}")

    parts.append("\nResponde en el contexto de este analisis. Se concreto y util para las decisiones del consultor.")
    return "\n".join(parts)


class AdvisorMessage(BaseModel):
    role: str  # "user" or "assistant"
    content: str


class FileAttachment(BaseModel):
    name: str
    type: str  # "image", "document", or "binary"
    content: str  # base64 for images/binaries, extracted text for documents
    mime_type: Optional[str] = None  # e.g., "image/png", "application/pdf"
    size: int = 0


class AdvisorRequest(BaseModel):
    query: str
    conversation_history: list[AdvisorMessage] = []
    project_id: Optional[str] = None
    # Multi-file support (up to 6)
    files: Optional[list[FileAttachment]] = None
    urls: Optional[list[str]] = None
    # HITL: analysis context when advisor is embedded in plan review or results
    analysis_context: Optional[dict] = None
    # Legacy single-file support (backward compatibility)
    file_content: Optional[str] = None
    file_name: Optional[str] = None


class AdvisorResponse(BaseModel):
    answer: str
    sources: list[dict]
    rag_context_used: bool


# ─── Server-side file text extraction ─────────────────────────────

def _extract_pdf_text(file_bytes: bytes) -> str:
    """Extract text + tables from a PDF. Tries pdfplumber first, falls back to pdfminer."""
    import io

    # Try pdfplumber (best quality: text + tables)
    try:
        import pdfplumber

        parts: list[str] = []
        with pdfplumber.open(io.BytesIO(file_bytes)) as pdf:
            for i, page in enumerate(pdf.pages[:50], 1):
                page_text = page.extract_text() or ""
                if page_text.strip():
                    parts.append(f"--- Pagina {i} ---\n{page_text}")

                tables = page.extract_tables()
                for table in tables:
                    if not table:
                        continue
                    rows = []
                    for row in table:
                        cells = [str(cell or "").strip() for cell in row]
                        rows.append(" | ".join(cells))
                    if rows:
                        parts.append(f"[Tabla pagina {i}]\n" + "\n".join(rows))

        if parts:
            return "\n\n".join(parts)
    except ImportError:
        pass
    except Exception as e:
        logger.warning("pdfplumber failed for PDF: %s, trying fallback", e)

    # Fallback: pdfminer (text only, no tables)
    try:
        from pdfminer.high_level import extract_text as pdfminer_extract
        text = pdfminer_extract(io.BytesIO(file_bytes), maxpages=50)
        if text and text.strip():
            return text.strip()
    except ImportError:
        pass
    except Exception as e:
        logger.warning("pdfminer fallback also failed: %s", e)

    return "[PDF: no se pudo extraer texto. El archivo puede estar escaneado o protegido.]"


def _extract_excel_text(file_bytes: bytes, filename: str) -> str:
    """Extract text from Excel/CSV using pandas + openpyxl."""
    import pandas as pd
    import io

    parts: list[str] = []
    ext = filename.rsplit(".", 1)[-1].lower() if "." in filename else ""

    try:
        if ext == "csv":
            # Auto-detect separator
            sample = file_bytes[:4096].decode("utf-8", errors="replace")
            sep = ";" if sample.count(";") > sample.count(",") else ","
            df = pd.read_csv(io.BytesIO(file_bytes), sep=sep, on_bad_lines="skip")
            parts.append(f"--- CSV ({len(df)} filas x {len(df.columns)} columnas) ---")
            parts.append(df.to_markdown(index=False))
        else:
            xl = pd.ExcelFile(io.BytesIO(file_bytes))
            for sheet_name in xl.sheet_names[:10]:  # Max 10 sheets
                df = pd.read_excel(xl, sheet_name=sheet_name)
                if df.empty:
                    continue
                parts.append(
                    f"--- Hoja: {sheet_name} ({len(df)} filas x {len(df.columns)} columnas) ---"
                )
                # Limit rows for very large sheets
                if len(df) > 200:
                    parts.append(df.head(200).to_markdown(index=False))
                    parts.append(f"... ({len(df) - 200} filas mas omitidas)")
                else:
                    parts.append(df.to_markdown(index=False))
    except Exception as e:
        parts.append(f"[Error extrayendo Excel/CSV: {e}]")

    return "\n\n".join(parts) if parts else "[Archivo Excel/CSV sin datos]"


def _extract_docx_text(file_bytes: bytes) -> str:
    """Extract text from Word DOCX using python-docx."""
    import io

    try:
        from docx import Document
        doc = Document(io.BytesIO(file_bytes))

        parts: list[str] = []

        # Extract paragraphs
        for para in doc.paragraphs:
            if para.text.strip():
                parts.append(para.text)

        # Extract tables
        for t_idx, table in enumerate(doc.tables):
            rows = []
            for row in table.rows:
                cells = [cell.text.strip() for cell in row.cells]
                rows.append(" | ".join(cells))
            if rows:
                parts.append(f"\n[Tabla {t_idx + 1}]\n" + "\n".join(rows))

        return "\n".join(parts) if parts else "[Documento Word sin contenido]"
    except Exception as e:
        return f"[Error extrayendo Word: {e}]"


def _extract_binary_text(file_bytes: bytes, filename: str) -> str:
    """Route binary file to the appropriate text extractor."""
    ext = filename.rsplit(".", 1)[-1].lower() if "." in filename else ""

    if ext == "pdf":
        return _extract_pdf_text(file_bytes)
    elif ext in ("xlsx", "xls", "xlsm"):
        return _extract_excel_text(file_bytes, filename)
    elif ext == "csv":
        return _extract_excel_text(file_bytes, filename)
    elif ext in ("docx", "doc"):
        return _extract_docx_text(file_bytes)
    else:
        # Fallback: try reading as text
        try:
            return file_bytes.decode("utf-8", errors="replace")[:15000]
        except Exception:
            return f"[Formato no soportado: .{ext}]"


# ─── URL content fetching ─────────────────────────────────────────

async def _fetch_url_content(url: str) -> str:
    """Fetch text content from a URL for advisor context."""
    import httpx

    try:
        async with httpx.AsyncClient(follow_redirects=True, timeout=15.0) as client:
            resp = await client.get(url, headers={
                "User-Agent": "ResidusIA-Advisor/1.0",
                "Accept": "text/html,text/plain,application/json,*/*",
            })
            resp.raise_for_status()

            content_type = resp.headers.get("content-type", "")
            text = resp.text

            # Strip HTML tags for a rough text extraction
            if "html" in content_type:
                import re
                # Remove script/style blocks
                text = re.sub(r'<(script|style)[^>]*>.*?</\1>', '', text, flags=re.DOTALL | re.IGNORECASE)
                # Remove HTML tags
                text = re.sub(r'<[^>]+>', ' ', text)
                # Collapse whitespace
                text = re.sub(r'\s+', ' ', text).strip()

            return text[:15000]
    except Exception as e:
        return f"[Error al obtener URL {url}: {e}]"


# ─── Advisor core logic (shared by JSON and FormData endpoints) ───

IMAGE_EXTENSIONS = {"png", "jpg", "jpeg", "gif", "webp", "bmp", "tiff", "tif"}


async def _run_advisor(
    query: str,
    conversation_history: list[dict],
    project_id: Optional[str],
    processed_docs: list[tuple[str, str]],
    image_blocks: list[dict],
    url_list: list[str],
    analysis_context: Optional[dict] = None,
) -> dict:
    """
    Core advisor logic: RAG search → build prompt → Claude with thinking.
    Returns {"answer": str, "sources": list, "rag_context_used": bool}.
    """
    if rag_service is None or _config is None:
        raise HTTPException(status_code=503, detail="Service not initialized")

    from anthropic import AsyncAnthropic

    # 1. RAG search
    scopes = [RAGScope.GENERAL]
    if project_id:
        scopes.append(RAGScope.PROJECT)

    rag_response = await rag_service.search(
        query=query,
        project_id=project_id,
        scopes=scopes,
        top_k_per_scope=12,
        similarity_threshold=0.65,
    )
    has_rag_context = bool(rag_response.results)

    # 2. Fetch URLs in parallel
    url_contents: list[tuple[str, str]] = []
    if url_list:
        tasks = [_fetch_url_content(u) for u in url_list[:6]]
        results = await asyncio.gather(*tasks, return_exceptions=True)
        for url, result in zip(url_list, results):
            if isinstance(result, Exception):
                url_contents.append((url, f"[Error al obtener URL: {result}]"))
            else:
                url_contents.append((url, result))

    # 3. Build text context
    text_parts: list[str] = []

    if has_rag_context:
        text_parts.append(
            "CONTEXTO DE LA BASE DE CONOCIMIENTO:\n"
            f"{rag_response.context_text}\n"
        )

    for i, (name, text) in enumerate(processed_docs, 1):
        text_parts.append(f"DOCUMENTO ADJUNTO {i} ({name}):\n{text}\n")

    for i, (url, content) in enumerate(url_contents, 1):
        text_parts.append(f"CONTENIDO DE URL {i} ({url}):\n{content}\n")

    if image_blocks:
        text_parts.append(
            f"Se han adjuntado {len(image_blocks)} imagen(es). "
            "Analiza cada imagen en detalle: identifica residuos, codigos, "
            "etiquetas, valores de analisis quimicos, fichas de seguridad, "
            "o cualquier informacion relevante para la gestion de residuos.\n"
        )

    text_parts.append(f"PREGUNTA DEL CONSULTOR:\n{query}")

    # 4. Build multimodal content blocks
    user_content_blocks: list[dict] = []
    for img in image_blocks:
        user_content_blocks.append(img)
    user_content_blocks.append({
        "type": "text",
        "text": "\n---\n".join(text_parts),
    })

    # 5. Build messages
    messages = []
    for msg in conversation_history[-10:]:
        messages.append({"role": msg["role"], "content": msg["content"]})
    messages.append({"role": "user", "content": user_content_blocks})

    # 6. Call Claude with extended thinking + web search
    claude = AsyncAnthropic(api_key=_config.anthropic_api_key)

    # Web search tool: Claude decides when to search the web.
    # Anthropic executes the search server-side (uses Brave Search).
    # Cost: ~$0.01 per search. Max 3 searches per query.
    web_search_tool = {
        "type": "web_search_20250305",
        "name": "web_search",
        "max_uses": 3,
    }

    # Build system prompt, injecting analysis context if available
    system_prompt = ADVISOR_SYSTEM_PROMPT
    if analysis_context:
        system_prompt += _build_analysis_context_addendum(analysis_context)

    response = await claude.messages.create(
        model="claude-sonnet-4-20250514",
        max_tokens=32000,
        stream=True,
        thinking={
            "type": "enabled",
            "budget_tokens": 24000,
        },
        tools=[web_search_tool],
        system=system_prompt,
        messages=messages,
    )

    # Accumulate streamed response
    final_response = await response.get_final_message()

    # Parse response: extract answer text and web search results
    answer = ""
    web_sources: list[dict] = []

    for block in final_response.content:
        if block.type == "text":
            answer = block.text  # Last text block is the final answer
        elif block.type == "web_search_tool_result":
            # Extract web search results for source display
            for item in getattr(block, "content", []):
                if getattr(item, "type", None) == "web_search_result":
                    web_sources.append({
                        "title": getattr(item, "title", ""),
                        "url": getattr(item, "url", ""),
                        "scope": "web",
                    })

    # 7. Combine RAG sources + web sources
    sources = [
        {
            "document_id": r.document_id,
            "title": r.doc_title,
            "doc_type": r.doc_type,
            "similarity": round(r.similarity, 3),
            "scope": r.rag_scope.value if isinstance(r.rag_scope, RAGScope) else r.rag_scope,
            "excerpt": r.content[:200] + "..." if len(r.content) > 200 else r.content,
        }
        for r in rag_response.results
    ]

    # Add web sources (deduplicated by URL)
    seen_urls: set[str] = set()
    for ws in web_sources:
        if ws["url"] and ws["url"] not in seen_urls:
            seen_urls.add(ws["url"])
            sources.append({
                "document_id": ws["url"],
                "title": ws["title"],
                "doc_type": "web",
                "similarity": 0,
                "scope": "web",
                "excerpt": ws["url"],
            })

    web_search_used = len(web_sources) > 0
    logger.info(
        "Advisor: RAG=%s, web_search=%s (%d results), docs=%d, images=%d",
        has_rag_context, web_search_used, len(web_sources),
        len(processed_docs), len(image_blocks),
    )

    return {
        "answer": answer,
        "sources": sources,
        "rag_context_used": has_rag_context,
        "web_search_used": web_search_used,
    }


# ─── Advisor endpoint: JSON (text-only, through Vercel proxy) ────

@app.post("/api/advisor")
async def advisor_query(request: AdvisorRequest):
    """
    Asesor IA - JSON endpoint (for text-only queries through Vercel proxy).
    For file uploads, use POST /api/advisor/chat with FormData.
    """
    import base64

    try:
        # Normalize files
        files = list(request.files or [])
        if not files and request.file_content:
            files.append(FileAttachment(
                name=request.file_name or "archivo",
                type="document",
                content=request.file_content[:15000],
            ))

        processed_docs: list[tuple[str, str]] = []
        image_blocks: list[dict] = []

        for f in files[:6]:
            if f.type == "image" and f.mime_type:
                image_blocks.append({
                    "type": "image",
                    "source": {
                        "type": "base64",
                        "media_type": f.mime_type,
                        "data": f.content,
                    },
                })
            elif f.type == "binary":
                try:
                    file_bytes = base64.b64decode(f.content)
                    extracted = await asyncio.to_thread(
                        _extract_binary_text, file_bytes, f.name
                    )
                    processed_docs.append((f.name, extracted[:15000]))
                except Exception as e:
                    processed_docs.append((f.name, f"[Error procesando {f.name}: {e}]"))
            else:
                processed_docs.append((f.name, f.content[:15000]))

        history = [{"role": m.role, "content": m.content} for m in request.conversation_history]

        result = await _run_advisor(
            query=request.query,
            conversation_history=history,
            project_id=request.project_id,
            processed_docs=processed_docs,
            image_blocks=image_blocks,
            url_list=request.urls or [],
            analysis_context=request.analysis_context,
        )
        return result

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error en advisor (JSON): {e}")
        raise HTTPException(status_code=500, detail=str(e))


# ─── Advisor endpoint: FormData (file uploads, direct from browser) ──

@app.post("/api/advisor/chat")
async def advisor_chat(
    query: str = Form(...),
    conversation_history: str = Form(default="[]"),
    project_id: Optional[str] = Form(default=None),
    urls: str = Form(default="[]"),
    storage_files: str = Form(default="[]"),
    analysis_context: str = Form(default=""),
    files: list[UploadFile] = File(default=[]),
):
    """
    Asesor IA - FormData endpoint for file uploads.
    Frontend calls this directly (bypassing Vercel's 4.5MB payload limit).
    Accepts real file uploads via multipart/form-data.
    Large files (>4MB) arrive as storage_files (JSON array of {name, type, storage_path})
    already uploaded to Supabase Storage.
    """
    import base64 as b64
    import json

    try:
        # Parse JSON fields
        try:
            history = json.loads(conversation_history)
        except (json.JSONDecodeError, TypeError):
            history = []

        try:
            url_list = json.loads(urls)
        except (json.JSONDecodeError, TypeError):
            url_list = []

        try:
            storage_file_list = json.loads(storage_files)
        except (json.JSONDecodeError, TypeError):
            storage_file_list = []

        # Process uploaded files
        processed_docs: list[tuple[str, str]] = []
        image_blocks: list[dict] = []

        # Process large files from Supabase Storage
        if storage_file_list and _config:
            from supabase._async.client import create_client as acreate_client

            sb = await acreate_client(
                _config.supabase_url,
                _config.supabase_service_key,
            )
            for sf in storage_file_list[:6]:
                sf_name = sf.get("name", "archivo")
                sf_path = sf.get("storage_path", "")
                if not sf_path:
                    continue
                try:
                    file_bytes = await sb.storage.from_("documentos").download(sf_path)
                    if len(file_bytes) == 0:
                        continue
                    ext = sf_name.rsplit(".", 1)[-1].lower() if "." in sf_name else ""
                    if ext in IMAGE_EXTENSIONS:
                        encoded = b64.b64encode(file_bytes).decode("ascii")
                        mime = sf.get("type") or f"image/{ext}"
                        image_blocks.append({
                            "type": "image",
                            "source": {
                                "type": "base64",
                                "media_type": mime,
                                "data": encoded,
                            },
                        })
                        logger.info("Advisor: storage image %s (%d KB)", sf_name, len(file_bytes) // 1024)
                    else:
                        extracted = await asyncio.to_thread(
                            _extract_binary_text, file_bytes, sf_name
                        )
                        processed_docs.append((sf_name, extracted[:15000]))
                        logger.info("Advisor: storage doc %s (%d chars)", sf_name, len(extracted))
                except Exception as e:
                    processed_docs.append((sf_name, f"[Error descargando {sf_name} de Storage: {e}]"))
                    logger.warning("Advisor: storage download failed for %s: %s", sf_name, e)

        for upload in files[:6]:
            if not upload.filename:
                continue

            file_bytes = await upload.read()
            if len(file_bytes) == 0:
                continue
            if len(file_bytes) > 20 * 1024 * 1024:  # 20MB per file
                processed_docs.append(
                    (upload.filename, f"[Archivo demasiado grande: {upload.filename}]")
                )
                continue

            ext = upload.filename.rsplit(".", 1)[-1].lower() if "." in upload.filename else ""

            if ext in IMAGE_EXTENSIONS:
                # Images → base64 for Claude Vision
                encoded = b64.b64encode(file_bytes).decode("ascii")
                mime = upload.content_type or f"image/{ext}"
                image_blocks.append({
                    "type": "image",
                    "source": {
                        "type": "base64",
                        "media_type": mime,
                        "data": encoded,
                    },
                })
                logger.info("Advisor: image %s (%s, %d KB)", upload.filename, mime, len(file_bytes) // 1024)
            else:
                # Documents → extract text server-side
                try:
                    extracted = await asyncio.to_thread(
                        _extract_binary_text, file_bytes, upload.filename
                    )
                    processed_docs.append((upload.filename, extracted[:15000]))
                    logger.info(
                        "Advisor: extracted %d chars from %s",
                        len(extracted), upload.filename,
                    )
                except Exception as e:
                    processed_docs.append(
                        (upload.filename, f"[Error procesando {upload.filename}: {e}]")
                    )
                    logger.warning("Advisor: extraction failed for %s: %s", upload.filename, e)

        # Parse analysis_context
        parsed_analysis_context = None
        if analysis_context:
            try:
                parsed_analysis_context = json.loads(analysis_context)
            except (json.JSONDecodeError, TypeError):
                pass

        result = await _run_advisor(
            query=query,
            conversation_history=history,
            project_id=project_id,
            processed_docs=processed_docs,
            image_blocks=image_blocks,
            url_list=url_list,
            analysis_context=parsed_analysis_context,
        )
        return result

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error en advisor (FormData): {e}")
        raise HTTPException(status_code=500, detail=str(e))


# ═══════════════════════════════════════════════════════════════
# ANALISIS MULTI-AGENTE - LangGraph
# ═══════════════════════════════════════════════════════════════

class AnalyzeRequest(BaseModel):
    project_id: str
    agents: Optional[list[str]] = None  # None = all agents


@app.post("/api/analyze")
async def analyze_project(request: AnalyzeRequest):
    """
    Lanza el analisis multi-agente (LangGraph) para un proyecto.
    El consultor elige que agentes ejecutar via el campo 'agents'.
    Optimizador y Redactor siempre se ejecutan con los hallazgos disponibles.
    """
    if _config is None:
        raise HTTPException(status_code=503, detail="Service not initialized")

    from pipeline.agents import run_project_analysis

    try:
        result = await run_project_analysis(
            project_id=request.project_id,
            supabase_url=_config.supabase_url,
            supabase_key=_config.supabase_service_key,
            anthropic_api_key=_config.anthropic_api_key,
            openai_api_key=_config.openai_api_key,
            agents=request.agents,
        )
        return result
    except Exception as e:
        logger.error(f"Error en analisis del proyecto {request.project_id}: {e}")
        raise HTTPException(status_code=500, detail=str(e))


# ═══════════════════════════════════════════════════════════════
# ANALISIS HITL - Sesiones + Plan + Execute + Round2
# ═══════════════════════════════════════════════════════════════

class SessionUpdate(BaseModel):
    phase: Optional[str] = None
    proposed_plan: Optional[dict] = None
    approved_plan: Optional[dict] = None
    consultant_instructions: Optional[str] = None
    agent_focus: Optional[dict] = None
    round1_results: Optional[dict] = None
    round2_results: Optional[dict] = None


@app.post("/api/analyze/session")
async def create_session(project_id: str = Form(...), consultant_id: str = Form(...)):
    """Create a new HITL analysis session."""
    if _config is None:
        raise HTTPException(status_code=503, detail="Service not initialized")

    from supabase._async.client import create_client as acreate_client
    sb = await acreate_client(_config.supabase_url, _config.supabase_service_key)

    result = await sb.table("analysis_sessions").insert({
        "project_id": project_id,
        "consultant_id": consultant_id,
        "phase": "planning",
    }).execute()

    if not result.data:
        raise HTTPException(status_code=500, detail="Error creating session")

    return result.data[0]


@app.get("/api/analyze/session/{project_id}")
async def get_session(project_id: str):
    """Get the latest active session for a project."""
    if _config is None:
        raise HTTPException(status_code=503, detail="Service not initialized")

    from supabase._async.client import create_client as acreate_client
    sb = await acreate_client(_config.supabase_url, _config.supabase_service_key)

    result = await (
        sb.table("analysis_sessions")
        .select("*")
        .eq("project_id", project_id)
        .neq("phase", "complete")
        .order("created_at", desc=True)
        .limit(1)
        .execute()
    )

    if not result.data:
        return {"session": None}
    return {"session": result.data[0]}


@app.patch("/api/analyze/session/{session_id}")
async def update_session(session_id: str, request: SessionUpdate):
    """Update a session's state (phase, plan, results, etc.)."""
    if _config is None:
        raise HTTPException(status_code=503, detail="Service not initialized")

    from supabase._async.client import create_client as acreate_client
    sb = await acreate_client(_config.supabase_url, _config.supabase_service_key)

    updates = {k: v for k, v in request.model_dump().items() if v is not None}
    if not updates:
        raise HTTPException(status_code=400, detail="No fields to update")

    result = await (
        sb.table("analysis_sessions")
        .update(updates)
        .eq("id", session_id)
        .execute()
    )

    if not result.data:
        raise HTTPException(status_code=404, detail="Session not found")
    return result.data[0]


@app.get("/api/analyze/progress/{project_id}")
async def stream_analysis_progress(project_id: str):
    """SSE endpoint that streams real-time progress events during analysis."""
    from pipeline.agents.graph import get_progress_events

    async def event_stream():
        last_idx = 0
        while True:
            events = get_progress_events(project_id, last_idx)
            for event in events:
                yield f"data: {json.dumps(event)}\n\n"
                last_idx += 1
                if event.get("type") == "complete":
                    return
            await asyncio.sleep(1)

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


class PlanRequest(BaseModel):
    project_id: str


class ExecuteRequest(BaseModel):
    project_id: str
    agents: list[str]
    consultant_instructions: str = ""
    agent_focus: dict[str, str] = {}


class Round2Request(BaseModel):
    project_id: str
    agents: list[str]
    consultant_instructions: str = ""
    agent_focus: dict[str, str] = {}
    previous_findings: list[dict] = []


@app.post("/api/analyze/plan")
async def analyze_plan(request: PlanRequest):
    """Fase 0: Carga datos del proyecto y genera un plan de analisis inteligente."""
    if _config is None:
        raise HTTPException(status_code=503, detail="Service not initialized")

    from pipeline.agents import plan_analysis

    try:
        result = await plan_analysis(
            project_id=request.project_id,
            supabase_url=_config.supabase_url,
            supabase_key=_config.supabase_service_key,
            anthropic_api_key=_config.anthropic_api_key,
        )
        return result
    except Exception as e:
        logger.error(f"Error planificando analisis {request.project_id}: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/analyze/execute")
async def analyze_execute(request: ExecuteRequest):
    """Fase 2: Ejecuta el analisis con instrucciones del consultor."""
    if _config is None:
        raise HTTPException(status_code=503, detail="Service not initialized")

    from pipeline.agents import run_project_analysis
    from pipeline.agents.graph import clear_progress

    try:
        result = await run_project_analysis(
            project_id=request.project_id,
            supabase_url=_config.supabase_url,
            supabase_key=_config.supabase_service_key,
            anthropic_api_key=_config.anthropic_api_key,
            openai_api_key=_config.openai_api_key,
            agents=request.agents,
            consultant_instructions=request.consultant_instructions,
            agent_focus=request.agent_focus,
        )
        # Delay cleanup so SSE clients can read the "complete" event
        await asyncio.sleep(5)
        clear_progress(request.project_id)
        return result
    except Exception as e:
        clear_progress(request.project_id)
        logger.error(f"Error ejecutando analisis {request.project_id}: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/analyze/round2")
async def analyze_round2(request: Round2Request):
    """Fase 3: Segunda vuelta con hallazgos previos como contexto."""
    if _config is None:
        raise HTTPException(status_code=503, detail="Service not initialized")

    from pipeline.agents import run_project_analysis
    from pipeline.agents.graph import clear_progress

    try:
        result = await run_project_analysis(
            project_id=request.project_id,
            supabase_url=_config.supabase_url,
            supabase_key=_config.supabase_service_key,
            anthropic_api_key=_config.anthropic_api_key,
            openai_api_key=_config.openai_api_key,
            agents=request.agents,
            consultant_instructions=request.consultant_instructions,
            agent_focus=request.agent_focus,
            round_number=2,
            previous_findings=request.previous_findings,
        )
        await asyncio.sleep(5)
        clear_progress(request.project_id)
        return result
    except Exception as e:
        clear_progress(request.project_id)
        logger.error(f"Error en 2a vuelta {request.project_id}: {e}")
        raise HTTPException(status_code=500, detail=str(e))


# ═══════════════════════════════════════════════════════════════
# KNOWLEDGE BASE - Gestión de documentos normativos generales
# ═══════════════════════════════════════════════════════════════

@app.get("/api/knowledge-base")
async def list_knowledge_base(
    doc_type: Optional[str] = Query(None),
    search: Optional[str] = Query(None),
):
    """Lista los documentos de la base de conocimiento general (normativa, BREFs, guías)."""
    if rag_service is None:
        raise HTTPException(status_code=503, detail="Service not initialized")

    sb = await rag_service._get_supabase()

    query = sb.table("knowledge_documents").select(
        "id, titulo, tipo, naturaleza_pdf, total_paginas, total_chunks, "
        "tablas_encontradas, metadata, estado, fecha_documento, fecha_ingesta"
    )

    if doc_type:
        query = query.eq("tipo", doc_type)

    if search:
        query = query.ilike("titulo", f"%{search}%")

    query = query.order("fecha_ingesta", desc=True)
    result = await query.execute()

    return {
        "documents": result.data or [],
        "total": len(result.data or []),
    }


@app.get("/api/knowledge-base/stats")
async def knowledge_base_stats():
    """Estadísticas de la base de conocimiento general."""
    if rag_service is None:
        raise HTTPException(status_code=503, detail="Service not initialized")

    sb = await rag_service._get_supabase()

    # Total de documentos generales
    docs_result = await (
        sb.table("knowledge_documents")
        .select("id, tipo, total_chunks, total_paginas")
        .execute()
    )
    docs = docs_result.data or []

    # Contar por tipo
    by_type: dict[str, int] = {}
    total_chunks = 0
    total_pages = 0
    for doc in docs:
        tipo = doc.get("tipo", "desconocido")
        by_type[tipo] = by_type.get(tipo, 0) + 1
        total_chunks += doc.get("total_chunks") or 0
        total_pages += doc.get("total_paginas") or 0

    return {
        "total_documents": len(docs),
        "total_chunks": total_chunks,
        "total_pages": total_pages,
        "by_type": by_type,
    }


@app.delete("/api/knowledge-base/{doc_id}")
async def delete_knowledge_base_document(doc_id: str):
    """Elimina un documento de la base de conocimiento general."""
    if rag_service is None:
        raise HTTPException(status_code=503, detail="Service not initialized")

    sb = await rag_service._get_supabase()

    # Verificar que el documento existe y es general
    doc_result = await (
        sb.table("knowledge_documents")
        .select("id, storage_path")
        .eq("id", doc_id)
        .execute()
    )

    if not doc_result.data:
        raise HTTPException(status_code=404, detail="Documento no encontrado")

    doc = doc_result.data[0]

    # Eliminar chunks (CASCADE debería hacerlo, pero por seguridad)
    await sb.table("knowledge_chunks").delete().eq("document_id", doc_id).execute()
    # Eliminar documento
    await sb.table("knowledge_documents").delete().eq("id", doc_id).execute()

    # Eliminar archivo de Storage si existe
    if doc.get("storage_path"):
        try:
            from pipeline import UnifiedIngestionService
            storage_svc = service.storage if service else None
            if storage_svc:
                await storage_svc.delete_file(doc["storage_path"])
        except Exception:
            pass  # No fallar si el archivo ya no existe

    return {"success": True, "deleted_id": doc_id}


# ═══════════════════════════════════════════════════════════════
# GOOGLE DRIVE - Conexión OAuth2 y gestión de carpetas
# ═══════════════════════════════════════════════════════════════

_gdrive_client_id = os.environ.get("GOOGLE_CLIENT_ID", "")
_gdrive_client_secret = os.environ.get("GOOGLE_CLIENT_SECRET", "")


def _gdrive_configured() -> bool:
    return bool(_gdrive_client_id and _gdrive_client_secret)


def _gdrive_redirect_uri() -> str:
    frontend = os.environ.get("FRONTEND_URL", "http://localhost:3000")
    return f"{frontend}/api/gdrive/callback"


@app.get("/api/gdrive/auth-url")
async def gdrive_auth_url(
    consultant_id: str = Query(...),
    redirect_uri: Optional[str] = Query(None),
):
    """Generate Google OAuth2 authorization URL."""
    if not _gdrive_configured():
        raise HTTPException(
            status_code=501,
            detail="Google Drive no configurado. Falta GOOGLE_CLIENT_ID y GOOGLE_CLIENT_SECRET.",
        )

    from pipeline.google_drive import get_auth_url

    uri = redirect_uri or _gdrive_redirect_uri()
    url = get_auth_url(
        client_id=_gdrive_client_id,
        client_secret=_gdrive_client_secret,
        redirect_uri=uri,
        state=consultant_id,
    )
    return {"auth_url": url}


class GDriveExchangeRequest(BaseModel):
    code: str
    consultant_id: str
    redirect_uri: Optional[str] = None


@app.post("/api/gdrive/exchange")
async def gdrive_exchange(request: GDriveExchangeRequest):
    """
    Exchange OAuth code for tokens, save to DB, and create Drive folder structure.
    """
    if not _gdrive_configured():
        raise HTTPException(status_code=501, detail="Google Drive no configurado.")

    if rag_service is None:
        raise HTTPException(status_code=503, detail="Service not initialized")

    from pipeline.google_drive import exchange_code, GoogleDriveService

    # Exchange code for tokens (redirect_uri must match the one used in auth request)
    uri = request.redirect_uri or _gdrive_redirect_uri()
    tokens = exchange_code(
        code=request.code,
        client_id=_gdrive_client_id,
        client_secret=_gdrive_client_secret,
        redirect_uri=uri,
    )

    # Create folder structure in Drive
    gd = GoogleDriveService(
        access_token=tokens["access_token"],
        refresh_token=tokens["refresh_token"],
        client_id=_gdrive_client_id,
        client_secret=_gdrive_client_secret,
    )
    folders = gd.setup_full_structure()

    # Save tokens and folder IDs to database
    sb = await rag_service._get_supabase()
    await sb.table("consultant_gdrive").upsert({
        "consultant_id": request.consultant_id,
        "access_token": tokens["access_token"],
        "refresh_token": tokens["refresh_token"],
        "token_expiry": tokens.get("token_expiry"),
        "root_folder_id": folders["root_folder_id"],
        "folder_mapping": folders,
    }).execute()

    return {
        "success": True,
        "root_folder_id": folders["root_folder_id"],
        "folders_created": len(folders),
    }


@app.get("/api/gdrive/picker-token")
async def gdrive_picker_token(consultant_id: str = Query(...)):
    """Return a fresh access token for the Google Picker on the frontend."""
    if not _gdrive_configured():
        raise HTTPException(status_code=501, detail="Google Drive no configurado.")
    if rag_service is None:
        raise HTTPException(status_code=503, detail="Service not initialized")

    sb = await rag_service._get_supabase()
    result = await (
        sb.table("consultant_gdrive")
        .select("access_token, refresh_token")
        .eq("consultant_id", consultant_id)
        .execute()
    )
    if not result.data:
        raise HTTPException(status_code=404, detail="Google Drive no conectado.")

    data = result.data[0]

    from pipeline.google_drive import GoogleDriveService

    gd = GoogleDriveService(
        access_token=data["access_token"],
        refresh_token=data["refresh_token"],
        client_id=_gdrive_client_id,
        client_secret=_gdrive_client_secret,
    )
    # The credentials may have been refreshed during construction
    fresh_token = gd.refreshed_token

    # Persist refreshed token if it changed
    if fresh_token != data["access_token"]:
        await (
            sb.table("consultant_gdrive")
            .update({"access_token": fresh_token})
            .eq("consultant_id", consultant_id)
            .execute()
        )

    return {"access_token": fresh_token, "client_id": _gdrive_client_id}


class GDriveSetupFoldersRequest(BaseModel):
    consultant_id: str
    root_folder_id: Optional[str] = None  # If provided, use as root (from Picker)


@app.post("/api/gdrive/setup-folders")
async def gdrive_setup_folders(request: GDriveSetupFoldersRequest):
    """
    Create Drive folder structure using tokens already saved in DB.
    If root_folder_id is provided (from Picker), use it as root.
    Runs in background and returns immediately. Poll /api/gdrive/status
    to check when root_folder_id is set.
    """
    if not _gdrive_configured():
        raise HTTPException(status_code=501, detail="Google Drive no configurado.")

    if rag_service is None:
        raise HTTPException(status_code=503, detail="Service not initialized")

    sb = await rag_service._get_supabase()
    result = await (
        sb.table("consultant_gdrive")
        .select("access_token, refresh_token, root_folder_id")
        .eq("consultant_id", request.consultant_id)
        .execute()
    )

    if not result.data:
        raise HTTPException(status_code=404, detail="Google Drive no conectado. Conecta primero.")

    data = result.data[0]

    # Skip if folder structure already exists (unless user is re-picking a folder)
    if data.get("root_folder_id") and not request.root_folder_id:
        return {"status": "done", "root_folder_id": data["root_folder_id"], "already_exists": True}

    from pipeline.google_drive import GoogleDriveService

    gd = GoogleDriveService(
        access_token=data["access_token"],
        refresh_token=data["refresh_token"],
        client_id=_gdrive_client_id,
        client_secret=_gdrive_client_secret,
    )

    # If user picked a root folder via Picker, save it immediately
    if request.root_folder_id:
        await (
            sb.table("consultant_gdrive")
            .update({"root_folder_id": request.root_folder_id})
            .eq("consultant_id", request.consultant_id)
            .execute()
        )

    # Fire-and-forget: run folder creation in background
    task = asyncio.create_task(
        _run_setup_folders(request.consultant_id, gd, sb, request.root_folder_id)
    )
    _background_tasks.add(task)
    task.add_done_callback(_background_tasks.discard)

    return {
        "status": "running",
        "root_folder_id": request.root_folder_id,
        "message": "Creando estructura de carpetas en segundo plano. Esto puede tardar 1-2 minutos.",
    }


async def _run_setup_folders(
    consultant_id: str,
    gd: "GoogleDriveService",  # noqa: F821
    sb: "AsyncClient",  # noqa: F821
    root_folder_id: Optional[str] = None,
) -> None:
    """Background task that creates the full folder structure in Google Drive."""
    try:
        folders = await asyncio.to_thread(gd.setup_full_structure, root_folder_id)

        await sb.table("consultant_gdrive").update({
            "root_folder_id": folders["root_folder_id"],
            "folder_mapping": folders,
        }).eq("consultant_id", consultant_id).execute()

        logger.info("Setup-folders complete for %s: root=%s", consultant_id, folders["root_folder_id"])
    except Exception as e:
        logger.error("Setup-folders failed for %s: %s", consultant_id, e)


@app.get("/api/gdrive/status")
async def gdrive_status(consultant_id: str = Query(...)):
    """Check if the consultant has connected Google Drive."""
    if rag_service is None:
        raise HTTPException(status_code=503, detail="Service not initialized")

    try:
        sb = await rag_service._get_supabase()
    except Exception as e:
        raise HTTPException(
            status_code=503,
            detail=f"Error conectando a Supabase: {e}. Verifica SUPABASE_SERVICE_ROLE_KEY.",
        )
    result = await (
        sb.table("consultant_gdrive")
        .select("root_folder_id, folder_mapping, created_at, updated_at")
        .eq("consultant_id", consultant_id)
        .execute()
    )

    if not result.data:
        return {"connected": False}

    data = result.data[0]
    return {
        "connected": True,
        "root_folder_id": data["root_folder_id"],
        "connected_at": data["created_at"],
        "configured": _gdrive_configured(),
    }


async def _get_gdrive_service(consultant_id: str):
    """Helper: load tokens from DB and return a GoogleDriveService instance."""
    if rag_service is None:
        raise HTTPException(status_code=503, detail="Service not initialized")
    if not _gdrive_configured():
        raise HTTPException(status_code=501, detail="Google Drive no configurado.")

    sb = await rag_service._get_supabase()
    result = await (
        sb.table("consultant_gdrive")
        .select("access_token, refresh_token")
        .eq("consultant_id", consultant_id)
        .execute()
    )
    if not result.data:
        raise HTTPException(status_code=404, detail="Google Drive no conectado.")

    from pipeline.google_drive import GoogleDriveService
    data = result.data[0]
    gd = GoogleDriveService(
        access_token=data["access_token"],
        refresh_token=data["refresh_token"],
        client_id=_gdrive_client_id,
        client_secret=_gdrive_client_secret,
    )
    return gd, sb


@app.get("/api/gdrive/browse")
async def gdrive_browse(
    consultant_id: str = Query(...),
    folder_id: str = Query(...),
    page_token: Optional[str] = Query(None),
):
    """
    Browse a folder in the consultant's Google Drive.
    Returns items with sync status (whether each file is already indexed in the DB).
    """
    gd, sb = await _get_gdrive_service(consultant_id)

    listing = gd.list_folder(folder_id, page_token)

    # Get drive_file_ids already indexed in the DB
    file_ids = [item["id"] for item in listing["items"] if not item["isFolder"]]
    indexed_ids: set[str] = set()
    if file_ids:
        # Query in batches of 50 to avoid too-long queries
        for i in range(0, len(file_ids), 50):
            batch = file_ids[i : i + 50]
            indexed_result = await (
                sb.table("knowledge_documents")
                .select("drive_file_id")
                .in_("drive_file_id", batch)
                .execute()
            )
            for row in indexed_result.data or []:
                if row.get("drive_file_id"):
                    indexed_ids.add(row["drive_file_id"])

    # Enrich items with indexed status
    for item in listing["items"]:
        if item["isFolder"]:
            item["indexed"] = None
        else:
            item["indexed"] = item["id"] in indexed_ids

    return listing


class GDriveIngestRequest(BaseModel):
    consultant_id: str
    file_id: str
    file_name: str
    folder_path: str = ""  # breadcrumb path for context


@app.post("/api/gdrive/ingest-file")
async def gdrive_ingest_file(request: GDriveIngestRequest):
    """
    Download a file from Google Drive and ingest it through the pipeline.
    Stores drive_file_id on the resulting document for sync tracking.
    """
    if service is None:
        raise HTTPException(status_code=503, detail="Service not initialized")

    gd, sb = await _get_gdrive_service(request.consultant_id)

    # Check if already indexed
    existing = await (
        sb.table("knowledge_documents")
        .select("id")
        .eq("drive_file_id", request.file_id)
        .execute()
    )
    if existing.data:
        raise HTTPException(
            status_code=409,
            detail="Este archivo ya esta indexado en la base de datos."
        )

    # Download from Drive
    try:
        file_bytes, filename, mime_type = gd.download_file(request.file_id)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error descargando de Drive: {e}")

    if len(file_bytes) == 0:
        raise HTTPException(status_code=400, detail="El archivo esta vacio.")

    if len(file_bytes) > 100 * 1024 * 1024:
        raise HTTPException(status_code=413, detail="Archivo demasiado grande (max 100 MB)")

    # Ingest through the pipeline
    try:
        result = await service.ingest(
            file_bytes=file_bytes,
            filename=filename,
            rag_scope="general",
        )

        if not result.success:
            raise HTTPException(
                status_code=422,
                detail=result.error or f"Error al procesar '{filename}'.",
            )

        # Update the document record with drive_file_id
        doc_id = result.supabase_doc_id or result.doc_id
        if doc_id:
            await (
                sb.table("knowledge_documents")
                .update({"drive_file_id": request.file_id})
                .eq("id", doc_id)
                .execute()
            )

        return {
            **result.to_dict(),
            "drive_file_id": request.file_id,
            "source_filename": filename,
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ═══════════════════════════════════════════════════════════════
# GOOGLE DRIVE SYNC - Auto-sync & bulk ingestion
# ═══════════════════════════════════════════════════════════════

class GDriveSyncRequest(BaseModel):
    consultant_id: str
    folder_id: Optional[str] = None  # None = use root folder


@app.post("/api/gdrive/sync")
async def gdrive_sync(request: GDriveSyncRequest):
    """
    Scan Google Drive for new documents and ingest them automatically.
    Creates a sync log entry, launches the heavy work as a background task,
    and returns immediately so the caller (Vercel) does not time out.
    The frontend polls /api/gdrive/sync-status to track progress.
    """
    if service is None:
        raise HTTPException(status_code=503, detail="Service not initialized")

    try:
        gd, sb = await _get_gdrive_service(request.consultant_id)
    except HTTPException:
        raise
    except Exception as e:
        logger.error("Sync: error getting GDrive service: %s", e)
        raise HTTPException(status_code=500, detail=f"Error obteniendo servicio GDrive: {e}")

    # Determine root folder
    folder_id = request.folder_id
    if not folder_id:
        try:
            gdrive_row = await (
                sb.table("consultant_gdrive")
                .select("root_folder_id")
                .eq("consultant_id", request.consultant_id)
                .execute()
            )
        except Exception as e:
            logger.error("Sync: error querying root folder: %s", e)
            raise HTTPException(status_code=500, detail=f"Error consultando carpeta raiz: {e}")
        if not gdrive_row.data or not gdrive_row.data[0].get("root_folder_id"):
            raise HTTPException(status_code=404, detail="No hay carpeta raiz configurada. Ve a Ajustes y pulsa 'Crear estructura de carpetas'.")
        folder_id = gdrive_row.data[0]["root_folder_id"]

    # Check if a sync is already running for this consultant
    try:
        running_check = await (
            sb.table("gdrive_sync_log")
            .select("id, started_at")
            .eq("consultant_id", request.consultant_id)
            .eq("status", "running")
            .limit(1)
            .execute()
        )
    except Exception as e:
        logger.error("Sync: error checking running sync: %s", e)
        raise HTTPException(status_code=500, detail=f"Error consultando estado de sync: {e}")
    if running_check.data:
        # Auto-expire syncs that have been running for more than 30 minutes
        from datetime import datetime, timezone, timedelta
        started_at_str = running_check.data[0].get("started_at", "")
        stale_sync = False
        try:
            started_at = datetime.fromisoformat(started_at_str.replace("Z", "+00:00"))
            if datetime.now(timezone.utc) - started_at > timedelta(minutes=30):
                stale_sync = True
        except (ValueError, TypeError):
            stale_sync = True  # Can't parse date — treat as stale

        if stale_sync:
            stale_id = running_check.data[0]["id"]
            logger.warning("Sync %s: stale sync detected (started %s), marking as error", stale_id, started_at_str)
            try:
                await (
                    sb.table("gdrive_sync_log")
                    .update({
                        "status": "error",
                        "completed_at": datetime.now(timezone.utc).isoformat(),
                        "error_message": "Sync expirado: superó el límite de 30 minutos. Posible caída del servidor.",
                    })
                    .eq("id", stale_id)
                    .execute()
                )
            except Exception:
                pass
            # Fall through to create a new sync
        else:
            return {
                "sync_id": running_check.data[0]["id"],
                "status": "already_running",
                "message": "Ya hay una sincronizacion en curso. Consulta sync-status para ver el progreso.",
            }

    # Create sync log entry
    try:
        sync_log = await (
            sb.table("gdrive_sync_log")
            .insert({
                "consultant_id": request.consultant_id,
                "status": "running",
            })
            .execute()
        )
        if not sync_log.data:
            raise HTTPException(status_code=500, detail="No se pudo crear el registro de sync en gdrive_sync_log.")
        sync_id = sync_log.data[0]["id"]
    except HTTPException:
        raise
    except Exception as e:
        logger.error("Sync: error creating sync log: %s", e)
        raise HTTPException(status_code=500, detail=f"Error creando registro de sync: {e}")

    # Fire-and-forget: launch heavy work in background
    async def _safe_sync_wrapper():
        """Wrapper to ensure exceptions from background task are always logged."""
        try:
            logger.info("Sync %s: background task STARTING", sync_id)
            await _run_sync_job(sync_id, request.consultant_id, folder_id, gd, sb)
            logger.info("Sync %s: background task FINISHED", sync_id)
        except Exception as e:
            logger.error("Sync %s: background task CRASHED: %s", sync_id, e, exc_info=True)

    task = asyncio.create_task(_safe_sync_wrapper())
    _background_tasks.add(task)
    task.add_done_callback(_background_tasks.discard)

    # Return immediately
    return {
        "sync_id": sync_id,
        "status": "running",
        "message": "Sincronizacion iniciada. Consulta sync-status para ver el progreso.",
    }


async def _run_sync_job(
    sync_id: str,
    consultant_id: str,
    folder_id: str,
    gd: "GoogleDriveService",  # noqa: F821
    sb: "AsyncClient",  # noqa: F821
) -> None:
    """Background task that does the actual sync work."""
    from datetime import datetime, timezone

    async def _update_sync_progress(**fields: object) -> None:
        """Helper to update gdrive_sync_log with current progress."""
        try:
            await (
                sb.table("gdrive_sync_log")
                .update(fields)
                .eq("id", sync_id)
                .execute()
            )
        except Exception:
            logger.warning("Sync %s: could not update progress", sync_id)

    try:
        # 1. Recursively list all files in Drive (run in thread to avoid blocking event loop)
        logger.info("Sync %s: _run_sync_job entered, folder=%s, service=%s", sync_id, folder_id, service is not None)
        logger.info("Sync %s: scanning Drive folder %s ...", sync_id, folder_id)
        all_files = await asyncio.to_thread(gd.list_all_files_recursive, folder_id)
        total_found = len(all_files)
        logger.info("Sync %s: found %d files in Drive", sync_id, total_found)

        # Update total_files_found immediately so the UI can show scan results
        await _update_sync_progress(total_files_found=total_found)

        # 2. Check which are already indexed
        all_drive_ids = [f["id"] for f in all_files]
        indexed_ids: set[str] = set()
        for i in range(0, len(all_drive_ids), 50):
            batch = all_drive_ids[i:i + 50]
            result = await (
                sb.table("knowledge_documents")
                .select("drive_file_id")
                .in_("drive_file_id", batch)
                .execute()
            )
            for row in result.data or []:
                if row.get("drive_file_id"):
                    indexed_ids.add(row["drive_file_id"])

        new_files = [f for f in all_files if f["id"] not in indexed_ids]
        skipped = len(all_files) - len(new_files)
        logger.info("Sync %s: %d new files to ingest, %d already indexed", sync_id, len(new_files), skipped)

        # Update skipped count immediately
        await _update_sync_progress(files_skipped=skipped)

        # 3. Ingest new files
        ingested = 0
        failed = 0
        details: list[dict] = []

        for file_info in new_files:
            try:
                file_bytes, filename, mime_type = await asyncio.to_thread(
                    gd.download_file, file_info["id"]
                )

                if len(file_bytes) == 0:
                    details.append({
                        "file": file_info["name"],
                        "status": "skipped",
                        "reason": "empty file",
                    })
                    skipped += 1
                    await _update_sync_progress(files_skipped=skipped)
                    continue

                if len(file_bytes) > 100 * 1024 * 1024:
                    details.append({
                        "file": file_info["name"],
                        "status": "skipped",
                        "reason": "too large (>100MB)",
                    })
                    skipped += 1
                    await _update_sync_progress(files_skipped=skipped)
                    continue

                result = await asyncio.wait_for(
                    service.ingest(
                        file_bytes=file_bytes,
                        filename=filename,
                    ),
                    timeout=300,  # 5 min max per file
                )

                if not result.success:
                    failed += 1
                    details.append({
                        "file": file_info["name"],
                        "path": file_info.get("path", ""),
                        "status": "error",
                        "error": result.error or "Ingestion failed",
                    })
                    logger.warning("Sync %s: ingestion failed for %s: %s", sync_id, filename, result.error)
                    await _update_sync_progress(files_failed=failed)
                    continue

                doc_id = result.supabase_doc_id or result.doc_id
                if doc_id:
                    await (
                        sb.table("knowledge_documents")
                        .update({"drive_file_id": file_info["id"]})
                        .eq("id", doc_id)
                        .execute()
                    )

                ingested += 1
                details.append({
                    "file": file_info["name"],
                    "path": file_info.get("path", ""),
                    "status": "ingested",
                    "document_id": doc_id,
                    "chunks": result.num_chunks,
                })
                logger.info("Sync %s: ingested %s (%d chunks)", sync_id, filename, result.num_chunks or 0)

                # Update progress after each successful ingestion
                await _update_sync_progress(files_ingested=ingested)

            except (asyncio.TimeoutError, TimeoutError):
                failed += 1
                details.append({
                    "file": file_info["name"],
                    "path": file_info.get("path", ""),
                    "status": "error",
                    "error": "Timeout: file took >5 min to process, skipped",
                })
                logger.warning("Sync %s: TIMEOUT processing %s (>5 min), skipping", sync_id, file_info["name"])
                await _update_sync_progress(files_failed=failed)
            except Exception as e:
                failed += 1
                details.append({
                    "file": file_info["name"],
                    "path": file_info.get("path", ""),
                    "status": "error",
                    "error": str(e)[:200],
                })
                logger.warning("Sync %s: failed %s: %s", sync_id, file_info["name"], e)
                await _update_sync_progress(files_failed=failed)

        # 4. Final update of sync log
        now_iso = datetime.now(timezone.utc).isoformat()
        await (
            sb.table("gdrive_sync_log")
            .update({
                "status": "completed",
                "completed_at": now_iso,
                "total_files_found": total_found,
                "files_ingested": ingested,
                "files_skipped": skipped,
                "files_failed": failed,
                "details": details,
            })
            .eq("id", sync_id)
            .execute()
        )

        # Update last_synced_at
        await (
            sb.table("consultant_gdrive")
            .update({"last_synced_at": now_iso})
            .eq("consultant_id", consultant_id)
            .execute()
        )

        logger.info(
            "Sync %s completed: %d ingested, %d skipped, %d failed",
            sync_id, ingested, skipped, failed,
        )

    except Exception as e:
        logger.error("Sync %s crashed: %s", sync_id, e)
        from datetime import datetime, timezone
        try:
            await (
                sb.table("gdrive_sync_log")
                .update({
                    "status": "error",
                    "completed_at": datetime.now(timezone.utc).isoformat(),
                    "error_message": str(e)[:500],
                })
                .eq("id", sync_id)
                .execute()
            )
        except Exception:
            logger.error("Sync %s: could not update error status", sync_id)


@app.get("/api/gdrive/sync-status")
async def gdrive_sync_status(consultant_id: str = Query(...)):
    """
    Get sync status: last sync info + auto-sync setting.
    """
    if rag_service is None:
        raise HTTPException(status_code=503, detail="Service not initialized")

    sb = await rag_service._get_supabase()

    # Get GDrive config
    gdrive_result = await (
        sb.table("consultant_gdrive")
        .select("last_synced_at, auto_sync_enabled")
        .eq("consultant_id", consultant_id)
        .execute()
    )

    gdrive_config = gdrive_result.data[0] if gdrive_result.data else {}

    # Get last 5 sync logs
    logs_result = await (
        sb.table("gdrive_sync_log")
        .select("*")
        .eq("consultant_id", consultant_id)
        .order("started_at", desc=True)
        .limit(5)
        .execute()
    )

    # Check if a sync is currently running
    running = any(
        log.get("status") == "running" for log in (logs_result.data or [])
    )

    return {
        "last_synced_at": gdrive_config.get("last_synced_at"),
        "auto_sync_enabled": gdrive_config.get("auto_sync_enabled", True),
        "is_syncing": running,
        "recent_syncs": logs_result.data or [],
    }


class GDriveAutoSyncToggle(BaseModel):
    consultant_id: str
    enabled: bool


@app.post("/api/gdrive/sync-toggle")
async def gdrive_sync_toggle(request: GDriveAutoSyncToggle):
    """Toggle auto-sync on/off."""
    if rag_service is None:
        raise HTTPException(status_code=503, detail="Service not initialized")

    sb = await rag_service._get_supabase()
    await (
        sb.table("consultant_gdrive")
        .update({"auto_sync_enabled": request.enabled})
        .eq("consultant_id", request.consultant_id)
        .execute()
    )
    return {"success": True, "auto_sync_enabled": request.enabled}


@app.post("/api/gdrive/sync-all")
async def gdrive_sync_all():
    """
    Sync ALL consultants with auto_sync_enabled=true.
    Called by cron job.
    """
    if service is None or rag_service is None:
        raise HTTPException(status_code=503, detail="Service not initialized")

    # Verify cron secret
    # (In production, check Authorization header against CRON_SECRET)

    sb = await rag_service._get_supabase()

    # Get all consultants with auto-sync enabled
    result = await (
        sb.table("consultant_gdrive")
        .select("consultant_id, root_folder_id")
        .eq("auto_sync_enabled", True)
        .execute()
    )

    results = []
    for row in result.data or []:
        cid = row["consultant_id"]
        try:
            sync_result = await gdrive_sync(GDriveSyncRequest(
                consultant_id=cid,
                folder_id=row.get("root_folder_id"),
            ))
            results.append({
                "consultant_id": cid,
                "status": "completed",
                "files_ingested": sync_result.get("files_ingested", 0),
            })
        except Exception as e:
            results.append({
                "consultant_id": cid,
                "status": "error",
                "error": str(e)[:200],
            })

    return {
        "consultants_synced": len(results),
        "results": results,
    }


@app.delete("/api/gdrive/disconnect")
async def gdrive_disconnect(consultant_id: str = Query(...)):
    """Disconnect Google Drive (delete stored tokens)."""
    if rag_service is None:
        raise HTTPException(status_code=503, detail="Service not initialized")

    sb = await rag_service._get_supabase()
    await (
        sb.table("consultant_gdrive")
        .delete()
        .eq("consultant_id", consultant_id)
        .execute()
    )

    return {"success": True}


# ─── RAG Health Check ──────────────────────────────────────────────
@app.get("/api/rag/health")
async def rag_health():
    """Diagnóstico del sistema RAG: docs sin chunks, estadísticas."""
    if rag_service is None:
        raise HTTPException(status_code=503, detail="Service not initialized")

    sb = await rag_service._get_supabase()
    result = await sb.rpc("rag_health_check").execute()
    return {"status": "ok", "scopes": result.data or []}


# ─── Re-process documents ─────────────────────────────────────────
class ReprocessRequest(BaseModel):
    doc_ids: list[str]
    scope: str = "knowledge"  # "knowledge" or "project"

@app.post("/api/reprocess")
async def reprocess_documents(req: ReprocessRequest):
    """Re-procesa documentos que no tienen chunks (o los tienen con error)."""
    if service is None or rag_service is None:
        raise HTTPException(status_code=503, detail="Service not initialized")

    sb = await rag_service._get_supabase()
    results = []

    for doc_id in req.doc_ids:
        try:
            # Obtener el documento original
            if req.scope == "knowledge":
                doc_result = await sb.table("knowledge_documents").select(
                    "id, titulo, storage_path, tipo"
                ).eq("id", doc_id).execute()
            else:
                doc_result = await sb.table("project_documents").select(
                    "id, titulo, storage_path, tipo, project_id"
                ).eq("id", doc_id).execute()

            if not doc_result.data:
                results.append({"doc_id": doc_id, "status": "not_found"})
                continue

            doc = doc_result.data[0]
            storage_path = doc.get("storage_path")

            if not storage_path:
                results.append({"doc_id": doc_id, "status": "no_storage_path"})
                continue

            # Descargar archivo desde Supabase Storage
            try:
                file_bytes = await sb.storage.from_("documentos").download(storage_path)
            except Exception as e:
                results.append({"doc_id": doc_id, "status": "download_error", "error": str(e)})
                continue

            filename = doc.get("titulo", "document.pdf")
            project_id = doc.get("project_id")
            rag_scope = "general" if req.scope == "knowledge" else "project"

            # Borrar chunks viejos antes de reprocesar
            chunk_table = "knowledge_chunks" if req.scope == "knowledge" else "project_chunks"
            await sb.table(chunk_table).delete().eq("document_id", doc_id).execute()

            # Re-ingestar usando la pipeline normal
            ingestion_result = await service.ingest(
                file_bytes=file_bytes,
                filename=filename,
                project_id=project_id,
                rag_scope=rag_scope,
            )

            results.append({
                "doc_id": doc_id,
                "status": "ok" if ingestion_result.success else "error",
                "num_chunks": ingestion_result.num_chunks,
                "error": ingestion_result.error,
            })
        except Exception as e:
            logger.exception(f"Error reprocesando {doc_id}: {e}")
            results.append({"doc_id": doc_id, "status": "error", "error": str(e)})

    success_count = sum(1 for r in results if r["status"] == "ok")
    return {
        "total": len(req.doc_ids),
        "success": success_count,
        "failed": len(req.doc_ids) - success_count,
        "results": results,
    }


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(
        "api.server:app",
        host="0.0.0.0",
        port=int(os.environ.get("PORT", os.environ.get("API_PORT", "8000"))),
        reload=True,
    )
