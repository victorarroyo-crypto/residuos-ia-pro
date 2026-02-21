"""
ResidusIA Pro - API Server
Expone el pipeline de procesamiento de documentos via HTTP.
"""

import os
import sys
from contextlib import asynccontextmanager
from typing import Optional

from fastapi import FastAPI, UploadFile, File, Form, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

# Ensure the project root is in the Python path (works locally and in Docker)
_project_root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if _project_root not in sys.path:
    sys.path.insert(0, _project_root)

from pipeline import UnifiedIngestionService, PipelineConfigImpl, RAGScopingService, RAGScope


service: UnifiedIngestionService | None = None
rag_service: RAGScopingService | None = None
_config: PipelineConfigImpl | None = None


@asynccontextmanager
async def lifespan(app: FastAPI):
    global service, rag_service, _config
    _config = PipelineConfigImpl(
        anthropic_api_key=os.environ["ANTHROPIC_API_KEY"],
        openai_api_key=os.environ["OPENAI_API_KEY"],
        supabase_url=os.environ.get(
            "SUPABASE_URL", os.environ.get("NEXT_PUBLIC_SUPABASE_URL", "")
        ),
        supabase_service_key=os.environ.get(
            "SUPABASE_SERVICE_KEY", os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "")
        ),
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
    file: UploadFile = File(...),
    client_id: str = Form(default=None),
    project_id: str = Form(default=None),
    rag_scope: str = Form(default=None),
    password: str = Form(default=None),
):
    if service is None:
        raise HTTPException(status_code=503, detail="Service not initialized")

    if not file.filename:
        raise HTTPException(status_code=400, detail="Filename is required")

    file_bytes = await file.read()

    if len(file_bytes) == 0:
        raise HTTPException(status_code=400, detail="File is empty")

    if len(file_bytes) > 100 * 1024 * 1024:  # 100 MB limit
        raise HTTPException(status_code=413, detail="File too large (max 100 MB)")

    try:
        result = await service.ingest(
            file_bytes=file_bytes,
            filename=file.filename,
            client_id=client_id,
            project_id=project_id,
            rag_scope=rag_scope,
            password=password,
        )
        return result.to_dict()
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ═══════════════════════════════════════════════════════════════
# RAG QUERY - Consulta con respuesta generada por LLM
# ═══════════════════════════════════════════════════════════════

class RAGQueryRequest(BaseModel):
    query: str
    client_id: Optional[str] = None
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
            client_id=request.client_id,
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

    query = sb.table("client_documents").select(
        "id, titulo, tipo, naturaleza_pdf, total_paginas, total_chunks, "
        "tablas_encontradas, metadata, estado, fecha_documento, fecha_ingesta"
    ).or_("client_id.is.null,client_id.eq.general")

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
        sb.table("client_documents")
        .select("id, tipo, total_chunks, total_paginas")
        .or_("client_id.is.null,client_id.eq.general")
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
        sb.table("client_documents")
        .select("id, client_id, storage_path")
        .eq("id", doc_id)
        .execute()
    )

    if not doc_result.data:
        raise HTTPException(status_code=404, detail="Documento no encontrado")

    doc = doc_result.data[0]
    if doc.get("client_id") and doc["client_id"] != "general":
        raise HTTPException(
            status_code=403,
            detail="Solo se pueden eliminar documentos de la base general"
        )

    # Eliminar chunks
    await sb.table("document_chunks").delete().eq("document_id", doc_id).execute()
    # Eliminar documento
    await sb.table("client_documents").delete().eq("id", doc_id).execute()

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
                sb.table("client_documents")
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
        sb.table("client_documents")
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

        # Update the document record with drive_file_id
        if result.document_id:
            await (
                sb.table("client_documents")
                .update({"drive_file_id": request.file_id})
                .eq("id", result.document_id)
                .execute()
            )

        return {
            **result.to_dict(),
            "drive_file_id": request.file_id,
            "source_filename": filename,
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


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


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(
        "api.server:app",
        host="0.0.0.0",
        port=int(os.environ.get("PORT", os.environ.get("API_PORT", "8000"))),
        reload=True,
    )
