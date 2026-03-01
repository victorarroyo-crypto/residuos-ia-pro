"""
PUNTO DE ENTRADA UNIFICADO DE INGESTA
=======================================
Una sola función para subir cualquier documento.
Detecta automáticamente si es PDF, Excel o CSV y lo procesa con la pipeline correcta.
También gestiona el scope RAG (general vs proyecto).

Uso desde la UI (Lovable/Next.js):
  POST /api/ingest
  {
    "file": <bytes>,
    "filename": "aai_empresa.pdf",
    "project_id": "uuid",
    "rag_scope": "project",   // opcional, se detecta automáticamente
    "password": "1234"        // opcional, solo para PDFs encriptados
  }
"""

import logging
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

import magic

from .pdf_pipeline import PDFPipeline
from .excel_processor import ExcelProcessor
from .text_processor import TextProcessor
from .rag_scoping import DocumentIngestionRouter, RAGScope
from .storage import StorageService

logger = logging.getLogger(__name__)

SUPPORTED_EXTENSIONS = {
    "pdf":  "pdf",
    "xlsx": "excel",
    "xls":  "excel",
    "xlsm": "excel",
    "csv":  "excel",   # CSV pasa por el mismo procesador que Excel
    "docx": "text",
    "doc":  "text",
    "txt":  "text",
    "html": "text",
    "htm":  "text",
    "md":   "text",
}

# MIME types permitidos por tipo de archivo.
# python-magic detecta el tipo real del contenido independientemente de la extensión.
_ALLOWED_MIMES: dict[str, set[str]] = {
    "pdf":  {"application/pdf"},
    "xlsx": {"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
             "application/zip", "application/octet-stream"},
    "xlsm": {"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
             "application/zip", "application/octet-stream"},
    "xls":  {"application/vnd.ms-excel", "application/octet-stream",
             "application/x-ole-storage", "application/CDFV2"},
    "csv":  {"text/plain", "text/csv", "application/csv", "text/x-csv"},
    "docx": {"application/vnd.openxmlformats-officedocument.wordprocessingml.document",
             "application/zip", "application/octet-stream"},
    "doc":  {"application/msword", "application/octet-stream",
             "application/x-ole-storage", "application/CDFV2"},
    "txt":  {"text/plain", "text/x-python", "text/x-c", "text/x-java"},
    "html": {"text/html", "text/plain"},
    "htm":  {"text/html", "text/plain"},
    "md":   {"text/plain", "text/x-python", "text/markdown"},
}


def _validate_magic_bytes(file_bytes: bytes, ext: str) -> str | None:
    """
    Valida que los magic bytes del archivo coincidan con la extensión declarada.
    Retorna None si es válido, o un mensaje de error si no coincide.
    """
    allowed = _ALLOWED_MIMES.get(ext)
    if not allowed:
        return None  # extensión sin regla → no bloquear

    try:
        detected = magic.from_buffer(file_bytes[:8192], mime=True)
    except Exception as e:
        logger.warning("Error detectando MIME con magic: %s (se permite el archivo)", e)
        return None  # si magic falla, no bloquear

    if detected in allowed:
        return None  # OK

    return (
        f"El contenido real del archivo ({detected}) no coincide con la extensión "
        f"declarada (.{ext}). Posible archivo manipulado."
    )


@dataclass
class IngestionResult:
    success: bool
    doc_id: str
    filename: str
    doc_type: str
    rag_scope: str
    num_chunks: int
    storage_path: Optional[str]
    supabase_doc_id: Optional[str]
    ler_codes_found: list[str]
    warnings: list[str]
    error: Optional[str] = None

    def to_dict(self) -> dict:
        return {
            "success": self.success,
            "doc_id": self.doc_id,
            "filename": self.filename,
            "doc_type": self.doc_type,
            "rag_scope": self.rag_scope,
            "num_chunks": self.num_chunks,
            "storage_path": self.storage_path,
            "supabase_doc_id": self.supabase_doc_id,
            "ler_codes_found": self.ler_codes_found,
            "warnings": self.warnings,
            "error": self.error,
        }


class UnifiedIngestionService:
    """
    Orquesta la ingesta de cualquier tipo de documento.
    Detecta el formato, selecciona la pipeline correcta y gestiona el scope RAG.
    """

    def __init__(self, config):
        self.config = config
        self.pdf_pipeline    = PDFPipeline(config)
        self.excel_processor = ExcelProcessor(config)
        self.text_processor  = TextProcessor(config)
        self.storage         = StorageService(config)
        self.router          = DocumentIngestionRouter()

    async def ingest(
        self,
        file_bytes: bytes,
        filename: str,
        project_id: Optional[str] = None,
        rag_scope: Optional[str] = None,
        password: Optional[str] = None,
    ) -> IngestionResult:
        """
        Punto de entrada único para cualquier documento.
        """
        ext = Path(filename).suffix.lower().lstrip(".")
        file_type = SUPPORTED_EXTENSIONS.get(ext)

        if not file_type:
            return IngestionResult(
                success=False, doc_id="", filename=filename,
                doc_type="desconocido", rag_scope="unknown", num_chunks=0,
                storage_path=None, supabase_doc_id=None,
                ler_codes_found=[], warnings=[],
                error=f"Formato no soportado: .{ext}. Formatos válidos: PDF, Excel, CSV",
            )

        # Validar magic bytes: el contenido real debe coincidir con la extensión
        magic_error = _validate_magic_bytes(file_bytes, ext)
        if magic_error:
            logger.warning("Magic bytes rechazados: %s → %s", filename, magic_error)
            return IngestionResult(
                success=False, doc_id="", filename=filename,
                doc_type="rechazado", rag_scope="unknown", num_chunks=0,
                storage_path=None, supabase_doc_id=None,
                ler_codes_found=[], warnings=[],
                error=magic_error,
            )

        logger.info(f"Ingesta: {filename} ({file_type}) | proyecto={project_id}")

        try:
            if file_type == "pdf":
                return await self._ingest_pdf(
                    file_bytes, filename, project_id, rag_scope, password
                )
            elif file_type == "text":
                return await self._ingest_text(
                    file_bytes, filename, project_id, rag_scope
                )
            else:
                return await self._ingest_excel(
                    file_bytes, filename, project_id, rag_scope
                )
        except Exception as e:
            logger.exception(f"Error en ingesta de {filename}: {e}")
            return IngestionResult(
                success=False, doc_id="", filename=filename,
                doc_type="error", rag_scope="unknown", num_chunks=0,
                storage_path=None, supabase_doc_id=None,
                ler_codes_found=[], warnings=[],
                error=str(e),
            )

    async def _ingest_pdf(
        self,
        file_bytes: bytes,
        filename: str,
        project_id: Optional[str],
        rag_scope_str: Optional[str],
        password: Optional[str],
    ) -> IngestionResult:
        result = await self.pdf_pipeline.process(
            pdf_bytes=file_bytes,
            client_id=project_id or "general",
            filename=filename,
            password=password,
            project_id=project_id,
        )

        # Determinar scope
        explicit_scope = RAGScope(rag_scope_str) if rag_scope_str else None
        scope = self.router.route(
            doc_type=result.doc_type.value,
            project_id=project_id,
            explicit_scope=explicit_scope,
        )

        # Actualizar metadatos con scope y project_id
        await self._update_chunk_scope(result.chunks, scope, project_id)

        return IngestionResult(
            success=True,
            doc_id=result.doc_id,
            filename=filename,
            doc_type=result.doc_type.value,
            rag_scope=scope.value,
            num_chunks=len(result.chunks),
            storage_path=result.storage_path,
            supabase_doc_id=result.supabase_doc_id,
            ler_codes_found=result.metadata.get("ler_codes_found", []),
            warnings=result.extraction_warnings,
        )

    async def _ingest_excel(
        self,
        file_bytes: bytes,
        filename: str,
        project_id: Optional[str],
        rag_scope_str: Optional[str],
    ) -> IngestionResult:

        # Determinar scope antes de procesar
        explicit_scope = RAGScope(rag_scope_str) if rag_scope_str else None
        scope = self.router.route(
            doc_type="costes_anuales",
            project_id=project_id,
            explicit_scope=explicit_scope,
        )

        result = await self.excel_processor.process(
            excel_bytes=file_bytes,
            client_id=project_id or "general",
            filename=filename,
            project_id=project_id,
            rag_scope=scope.value,
        )

        # Generar embeddings para los chunks de Excel
        from .config import EmbeddingService
        embedder = EmbeddingService(self.config)
        result.chunks = await embedder.embed_all(result.chunks)

        # Guardar en Supabase
        sb = await self.storage._get_supabase()

        # Registro del documento
        doc_data = {
            "id": result.doc_id,
            "titulo": filename,
            "tipo": result.excel_type.value,
            "naturaleza_pdf": "excel",
            "total_paginas": len(result.sheets),
            "total_chunks": len(result.chunks),
            "tablas_encontradas": len(result.sheets),
            "metadata": result.metadata,
            "estado": "indexado",
            "fecha_ingesta": datetime.now(timezone.utc).isoformat(),
        }

        # project_documents requiere project_id; knowledge_documents no lo tiene
        if scope == RAGScope.PROJECT:
            doc_data["project_id"] = project_id

        # Subir archivo original a Supabase Storage (no bloquea el pipeline)
        from .pdf_pipeline import DocType
        try:
            storage_path = await self.storage.upload_file(
                file_bytes, filename, project_id or "general",
                DocType.DESCONOCIDO,
            )
        except Exception as e:
            logger.warning(f"Storage upload omitido para {filename}: {e}")
            storage_path = None
        doc_data["storage_path"] = storage_path

        # Determinar tabla destino según scope
        doc_table = "knowledge_documents" if scope == RAGScope.GENERAL else "project_documents"
        upsert_result = await sb.table(doc_table).upsert(doc_data).execute()
        if not upsert_result.data:
            raise RuntimeError(f"Fallo al guardar Excel {result.doc_id} en {doc_table}")

        # Guardar chunks con embeddings
        is_knowledge = scope == RAGScope.GENERAL
        await self.storage.save_chunks_to_supabase(
            result.chunks, result.doc_id,
            is_knowledge=is_knowledge, project_id=project_id,
        )

        # Poblar tablas estructuradas desde los datos del Excel
        await self._populate_structured_tables(sb, result, project_id)

        return IngestionResult(
            success=True,
            doc_id=result.doc_id,
            filename=filename,
            doc_type=result.excel_type.value,
            rag_scope=scope.value,
            num_chunks=len(result.chunks),
            storage_path=storage_path,
            supabase_doc_id=result.doc_id,
            ler_codes_found=result.metadata.get("ler_codes_found", []),
            warnings=result.warnings,
        )

    async def _ingest_text(
        self,
        file_bytes: bytes,
        filename: str,
        project_id: Optional[str],
        rag_scope_str: Optional[str],
    ) -> IngestionResult:
        # Determinar scope
        explicit_scope = RAGScope(rag_scope_str) if rag_scope_str else None
        scope = self.router.route(
            doc_type="normativa",
            project_id=project_id,
            explicit_scope=explicit_scope,
        )

        result = await self.text_processor.process(
            file_bytes=file_bytes,
            filename=filename,
            client_id=project_id or "general",
            project_id=project_id,
            rag_scope=scope.value,
        )

        return IngestionResult(
            success=True,
            doc_id=result.doc_id,
            filename=filename,
            doc_type=result.doc_type.value,
            rag_scope=scope.value,
            num_chunks=len(result.chunks),
            storage_path=result.storage_path,
            supabase_doc_id=result.supabase_doc_id,
            ler_codes_found=result.metadata.get("ler_codes_found", []),
            warnings=result.extraction_warnings,
        )

    async def _update_chunk_scope(self, chunks, scope: RAGScope, project_id: Optional[str]):
        """Actualiza el scope y project_id en los metadatos de los chunks."""
        for chunk in chunks:
            chunk.metadata["rag_scope"] = scope.value
            if project_id:
                chunk.metadata["project_id"] = project_id

    # Campos que son numeric en Supabase — si llegan como string, se descartan
    _NUMERIC_FIELDS = {
        "cantidad_anual_ton", "precio_actual_eur_ton", "cantidad_toneladas",
        "precio_unitario", "importe_eur", "año",
    }

    @classmethod
    def _clean_for_json(cls, data: dict) -> dict:
        """Limpia un dict para que sea JSON-serializable y valida tipos numéricos."""
        import math
        clean = {}
        for k, v in data.items():
            if hasattr(v, "item"):  # numpy scalar (int64, float64, etc.)
                v = v.item()
            if isinstance(v, float) and (math.isnan(v) or math.isinf(v)):
                continue
            if v is None or v == "":
                continue
            # Campos numéricos: rechazar si no es número
            if k in cls._NUMERIC_FIELDS:
                if isinstance(v, str):
                    try:
                        v = float(v.replace(",", "."))
                    except ValueError:
                        continue  # descartar string no numérico
                if not isinstance(v, (int, float)):
                    continue
            clean[k] = v
        return clean

    async def _populate_structured_tables(self, sb, result, project_id):
        """
        Desde los datos estructurados del Excel, pobla tablas de Supabase
        para que los agentes puedan hacer análisis sin releer el documento.
        """
        for sheet in result.sheets:
            cost_rows = sheet.structured_data.get("cost_rows", [])

            for row in cost_rows:
                if not row.get("importe_eur") and not row.get("precio_eur_ton"):
                    continue

                # Poblar waste_inventory con datos de coste reales
                inventory_data = self._clean_for_json({
                    "project_id": project_id,
                    "codigo_ler": row.get("codigo_ler"),
                    "descripcion": row.get("descripcion"),
                    "cantidad_anual_ton": row.get("cantidad_ton"),
                    "precio_actual_eur_ton": row.get("precio_eur_ton"),
                    "fuente_doc_id": result.doc_id,
                    "año": row.get("año"),
                })

                if inventory_data.get("codigo_ler") or inventory_data.get("descripcion"):
                    await sb.table("waste_inventory").upsert(inventory_data).execute()

                # Si hay importe total, también a invoice_lines para tracking financiero
                if row.get("importe_eur"):
                    invoice_data = self._clean_for_json({
                        "project_id": project_id,
                        "doc_id": result.doc_id,
                        "codigo_ler": row.get("codigo_ler"),
                        "descripcion": row.get("descripcion"),
                        "cantidad_toneladas": row.get("cantidad_ton"),
                        "precio_unitario": row.get("precio_eur_ton"),
                        "importe_eur": row.get("importe_eur"),
                    })
                    await sb.table("invoice_lines").upsert(invoice_data).execute()

        logger.info(f"Tablas estructuradas pobladas desde Excel: {result.filename}")
