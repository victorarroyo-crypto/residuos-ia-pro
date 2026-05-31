"""
ResidusIA Pro - API Server
Expone el pipeline de procesamiento de documentos via HTTP.
"""

import gc
import ipaddress
import json
import os
import re
import socket
import sys
import time
from contextlib import asynccontextmanager
from typing import Optional

import asyncio
import logging
from urllib.parse import urlparse

import httpx
from fastapi import FastAPI, UploadFile, File, Form, HTTPException, Query, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse, JSONResponse
from pydantic import BaseModel, Field, field_validator
from slowapi import Limiter
from slowapi.util import get_remote_address
from slowapi.errors import RateLimitExceeded

_UUID_PATTERN = r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$"
_VALID_TIERS = {"standard", "pro_plus"}
_VALID_MODELS = {
    "claude-opus-4-6", "claude-sonnet-4", "claude-haiku-4-5",
    "gpt-5.2", "gpt-5", "o3", "o4-mini", "gpt-5-mini",
    "gemini-2.5-pro", "gemini-2.5-flash",
}
_VALID_AGENTS = {"aai", "contratos", "facturas", "registro", "normativo"}

logging.basicConfig(level=logging.INFO, stream=sys.stdout)
logger = logging.getLogger("residusia")
logger.setLevel(logging.INFO)

# Silence noisy HTTP client loggers — these flood Railway logs as false "errors"
logging.getLogger("httpx").setLevel(logging.WARNING)
logging.getLogger("httpcore").setLevel(logging.WARNING)

# Ensure the project root is in the Python path (works locally and in Docker)
_project_root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if _project_root not in sys.path:
    sys.path.insert(0, _project_root)

from pipeline import UnifiedIngestionService, PipelineConfigImpl, RAGScopingService, RAGScope
from pipeline.cost_guard import CostGuard, calculate_cost, get_provider, MODEL_PRICING
from pipeline.model_router import ModelRouter, MODEL_API_IDS, MODEL_PROVIDERS, SERVICE_DEFAULTS


service: UnifiedIngestionService | None = None
rag_service: RAGScopingService | None = None
_config: PipelineConfigImpl | None = None
_cost_guard: CostGuard | None = None
_model_router: ModelRouter | None = None

# Strong references to background tasks so GC doesn't kill them.
# See: https://docs.python.org/3/library/asyncio-task.html#asyncio.create_task
_background_tasks: set[asyncio.Task] = set()


# ── Sync liveness / watchdog (Fase 0) ────────────────────────────────
# A running sync writes last_heartbeat every SYNC_HEARTBEAT_INTERVAL_SECONDS.
# If a running row goes silent for longer than SYNC_STALE_AFTER_SECONDS its
# worker/container is considered dead and it gets reaped. This replaces the old
# behaviour that killed every running row on restart and the passive 120-minute
# check that only fired when a new POST arrived.
SYNC_HEARTBEAT_INTERVAL_SECONDS = 30
SYNC_STALE_AFTER_SECONDS = 600  # 10 min without a heartbeat → reap
SYNC_REAPER_INTERVAL_SECONDS = 60


async def _sync_reaper_loop(sb) -> None:
    """Periodically mark as error any running sync whose heartbeat is stale.

    Runs for the lifetime of the process so orphaned syncs are cleaned up even
    when no request ever hits the sync endpoint again.
    """
    from datetime import datetime, timezone, timedelta

    while True:
        try:
            await asyncio.sleep(SYNC_REAPER_INTERVAL_SECONDS)
            cutoff = (
                datetime.now(timezone.utc) - timedelta(seconds=SYNC_STALE_AFTER_SECONDS)
            ).isoformat()
            result = await (
                sb.table("gdrive_sync_log")
                .update({
                    "status": "error",
                    "completed_at": datetime.now(timezone.utc).isoformat(),
                    "error_message": "Sync sin actividad (heartbeat expirado). Posible caída del worker.",
                })
                .eq("status", "running")
                .lt("last_heartbeat", cutoff)
                .execute()
            )
            reaped = len(result.data) if result.data else 0
            if reaped:
                logger.info("Reaper: marked %d stale sync(s) as error", reaped)
        except asyncio.CancelledError:
            raise
        except Exception as e:
            logger.warning("Reaper: iteration failed: %s", e)


@asynccontextmanager
async def lifespan(app: FastAPI):
    global service, rag_service, _config, _cost_guard, _model_router

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

    gemini_key = os.environ.get("GEMINI_API_KEY", "")
    if not gemini_key:
        logger.warning("GEMINI_API_KEY no configurada — fallback a Gemini deshabilitado")

    _config = PipelineConfigImpl(
        anthropic_api_key=os.environ["ANTHROPIC_API_KEY"],
        openai_api_key=os.environ["OPENAI_API_KEY"],
        gemini_api_key=gemini_key,
        supabase_url=supabase_url,
        supabase_service_key=supabase_key,
    )
    service = UnifiedIngestionService(_config)
    rag_service = RAGScopingService(_config)

    # Cost Guard & Model Router
    _cost_guard = CostGuard(supabase_url, supabase_key)
    _model_router = ModelRouter(
        anthropic_api_key=_config.anthropic_api_key,
        openai_api_key=_config.openai_api_key,
        gemini_api_key=gemini_key,
        cost_guard=_cost_guard,
    )

    # Share ModelRouter with agent LLM layer
    from pipeline.agents.llm import init_model_router
    init_model_router(_model_router, _cost_guard)
    logger.info("CostGuard + ModelRouter inicializados ✓")

    # Clean up zombie syncs left by previous server instances, but ONLY those
    # whose heartbeat is already stale. A sync that is genuinely still alive in
    # another worker keeps its running row; a fresh redeploy that killed the
    # worker leaves a row whose heartbeat stops, and the reaper (or this check)
    # will mark it as error after SYNC_STALE_AFTER_SECONDS.
    _reaper_task = None
    try:
        from datetime import datetime as _dt, timezone as _tz, timedelta as _td
        from supabase._async.client import create_client as acreate_client
        _startup_sb = await acreate_client(supabase_url, supabase_key)
        _cutoff = (
            _dt.now(_tz.utc) - _td(seconds=SYNC_STALE_AFTER_SECONDS)
        ).isoformat()
        _zombie_result = await (
            _startup_sb.table("gdrive_sync_log")
            .update({
                "status": "error",
                "completed_at": _dt.now(_tz.utc).isoformat(),
                "error_message": "Sync sin actividad (heartbeat expirado al reiniciar el servidor).",
            })
            .eq("status", "running")
            .lt("last_heartbeat", _cutoff)
            .execute()
        )
        _zombie_count = len(_zombie_result.data) if _zombie_result.data else 0
        if _zombie_count:
            logger.info("Startup: marked %d stale sync(s) as error", _zombie_count)

        # Launch the background reaper for the lifetime of the process.
        _reaper_task = asyncio.create_task(_sync_reaper_loop(_startup_sb))
    except Exception as e:
        logger.warning("Startup: could not clean stale syncs / start reaper: %s", e)

    yield

    if _reaper_task is not None:
        _reaper_task.cancel()
        try:
            await _reaper_task
        except (asyncio.CancelledError, Exception):
            pass


app = FastAPI(
    title="ResidusIA Pro API",
    description="Pipeline de procesamiento de documentos de residuos industriales",
    version="1.0.0",
    lifespan=lifespan,
)

# ── Rate Limiting ──────────────────────────────────────────
limiter = Limiter(key_func=get_remote_address)
app.state.limiter = limiter


@app.exception_handler(RateLimitExceeded)
async def _rate_limit_handler(request: Request, exc: RateLimitExceeded):
    return JSONResponse(
        status_code=429,
        content={
            "detail": "Demasiadas solicitudes. Intenta de nuevo en unos momentos.",
            "retry_after": exc.detail,
        },
    )


_frontend_url = os.environ.get("FRONTEND_URL", "")
_cors_origins = [_frontend_url] if _frontend_url else []
if os.environ.get("ENVIRONMENT", "development") != "production":
    _cors_origins.append("http://localhost:3000")

app.add_middleware(
    CORSMiddleware,
    allow_origins=_cors_origins,
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allow_headers=["Content-Type", "Authorization", "X-API-Key"],
)

# ── API Key authentication ───────────────────────────────────
# When PIPELINE_API_KEY is set, all endpoints (except /health) require
# the header X-API-Key to match.  If PIPELINE_API_KEY is empty/unset,
# authentication is skipped (local development).
_PIPELINE_API_KEY = os.environ.get("PIPELINE_API_KEY", "")
if _PIPELINE_API_KEY:
    logger.info("PIPELINE_API_KEY configured — API key authentication enabled ✓")
else:
    logger.warning("PIPELINE_API_KEY not set — API endpoints are UNPROTECTED")


@app.middleware("http")
async def _verify_api_key(request: Request, call_next):
    if request.url.path == "/health" or request.method == "OPTIONS":
        return await call_next(request)
    if _PIPELINE_API_KEY:
        provided = request.headers.get("x-api-key", "")
        if provided != _PIPELINE_API_KEY:
            return JSONResponse(
                status_code=401,
                content={"detail": "Invalid or missing API key"},
            )
    return await call_next(request)


@app.get("/health")
async def health():
    return {"status": "ok", "service": "residusia-pro-api"}


@app.post("/api/ingest")
@limiter.limit("10/minute")
async def ingest_document(
    request: Request,
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

    def _check_ssrf(url: str) -> None:
        """Block requests to private/internal IP addresses."""
        parsed = urlparse(url)
        hostname = parsed.hostname
        if not hostname:
            raise HTTPException(status_code=400, detail="URL sin hostname valido")
        try:
            resolved = socket.getaddrinfo(hostname, None, socket.AF_UNSPEC, socket.SOCK_STREAM)
            for family, _, _, _, sockaddr in resolved:
                ip = ipaddress.ip_address(sockaddr[0])
                if ip.is_private or ip.is_loopback or ip.is_link_local or ip.is_reserved:
                    raise HTTPException(
                        status_code=400,
                        detail="No se permiten URLs que apunten a direcciones IP internas",
                    )
        except socket.gaierror:
            raise HTTPException(status_code=400, detail=f"No se puede resolver el hostname: {hostname}")

    async def _validate_pdf_url(url: str) -> None:
        parsed = urlparse(url)
        if parsed.scheme not in {"http", "https"}:
            raise HTTPException(status_code=400, detail="file_url debe usar http/https")

        _check_ssrf(url)

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


# ══════════════════════════════════════════════════════════════
# RAG QUERY - Consulta con respuesta generada por LLM
# ══════════════════════════════════════════════════════════════

class RAGQueryRequest(BaseModel):
    query: str = Field(min_length=1, max_length=10000)
    project_id: Optional[str] = None
    scope: Optional[str] = None  # "general", "project", or None (both)
    top_k: int = Field(default=5, ge=1, le=50)


class RAGQueryResponse(BaseModel):
    answer: str
    sources: list[dict]
    query: str
    scope_used: list[str]


@app.post("/api/rag/query", response_model=RAGQueryResponse)
@limiter.limit("30/minute")
async def rag_query(request: Request, payload: RAGQueryRequest):
    """
    Consulta al RAG de documentos normativos y técnicos.
    Busca chunks relevantes y genera una respuesta con Claude.
    """
    if rag_service is None or _config is None:
        raise HTTPException(status_code=503, detail="RAG service not initialized")

    # Determinar scopes a consultar
    scopes = None
    if payload.scope == "general":
        scopes = [RAGScope.GENERAL]
    elif payload.scope == "project":
        scopes = [RAGScope.PROJECT]

    try:
        # Buscar en el RAG
        rag_response = await rag_service.search(
            query=payload.query,
            project_id=payload.project_id,
            scopes=scopes,
            top_k_per_scope=payload.top_k,
        )

        # Generar respuesta con Claude usando el contexto recuperado
        from anthropic import AsyncAnthropic
        claude = AsyncAnthropic(api_key=_config.anthropic_api_key, max_retries=4)

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
            f"{payload.query}"
        )

        try:
            message = await claude.messages.create(
                model="claude-sonnet-4-20250514",
                max_tokens=2000,
                system=system_prompt,
                messages=[{"role": "user", "content": user_prompt}],
            )
            answer = message.content[0].text
        except Exception as claude_err:
            is_overloaded = "overloaded" in str(claude_err).lower()
            if is_overloaded and _config.gemini_api_key:
                logger.warning("Claude overloaded in rag/query, falling back to Gemini 2.5 Pro")
                from google import genai
                from google.genai import types as genai_types
                gemini_client = genai.Client(api_key=_config.gemini_api_key)
                response = await gemini_client.aio.models.generate_content(
                    model="gemini-2.5-pro",
                    contents=[user_prompt],
                    config=genai_types.GenerateContentConfig(
                        system_instruction=system_prompt,
                        max_output_tokens=2000,
                        temperature=0.7,
                    ),
                )
                answer = response.text or ""
            else:
                raise

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
            query=payload.query,
            scope_used=scope_used,
        )

    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# PLACEHOLDER_REMAINDER
