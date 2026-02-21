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
    "client_id": "uuid",
    "project_id": "uuid",
    "rag_scope": "project",   // opcional, se detecta automáticamente
    "password": "1234"        // opcional, solo para PDFs encriptados
  }
"""

import logging
from dataclasses import dataclass
from pathlib import Path
from typing import Optional

from .pdf_pipeline import PDFPipeline
from .excel_processor import ExcelProcessor
from .rag_scoping import DocumentIngestionRouter, RAGScope
from .storage import StorageService

logger = logging.getLogger(__name__)

SUPPORTED_EXTENSIONS = {
    "pdf":  "pdf",
    "xlsx": "excel",
    "xls":  "excel",
    "xlsm": "excel",
    "csv":  "excel",   # CSV pasa por el mismo procesador que Excel
}


@dataclass
class IngestionResult:
    success: bool
    doc_id: str
    filename: str
    doc_type: str
    rag_scope: str
    num_chunks: int
    drive_file_id: Optional[str]
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
            "drive_file_id": self.drive_file_id,
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
        self.pdf_pipeline  = PDFPipeline(config)
        self.excel_processor = ExcelProcessor(config)
        self.storage       = StorageService(config)
        self.router        = DocumentIngestionRouter()

    async def ingest(
        self,
        file_bytes: bytes,
        filename: str,
        client_id: Optional[str] = None,
        project_id: Optional[str] = None,
        rag_scope: Optional[str] = None,
        password: Optional[str] = None,
        drive_upload: bool = True,
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
                drive_file_id=None, supabase_doc_id=None,
                ler_codes_found=[], warnings=[],
                error=f"Formato no soportado: .{ext}. Formatos válidos: PDF, Excel, CSV",
            )

        logger.info(f"Ingesta: {filename} ({file_type}) | cliente={client_id} | proyecto={project_id}")

        try:
            if file_type == "pdf":
                return await self._ingest_pdf(
                    file_bytes, filename, client_id, project_id, rag_scope, password, drive_upload
                )
            else:
                return await self._ingest_excel(
                    file_bytes, filename, client_id, project_id, rag_scope, drive_upload
                )
        except Exception as e:
            logger.exception(f"Error en ingesta de {filename}: {e}")
            return IngestionResult(
                success=False, doc_id="", filename=filename,
                doc_type="error", rag_scope="unknown", num_chunks=0,
                drive_file_id=None, supabase_doc_id=None,
                ler_codes_found=[], warnings=[],
                error=str(e),
            )

    async def _ingest_pdf(
        self,
        file_bytes: bytes,
        filename: str,
        client_id: Optional[str],
        project_id: Optional[str],
        rag_scope_str: Optional[str],
        password: Optional[str],
        drive_upload: bool,
    ) -> IngestionResult:
        result = await self.pdf_pipeline.process(
            pdf_bytes=file_bytes,
            client_id=client_id or "general",
            filename=filename,
            password=password,
            drive_upload=drive_upload,
        )

        # Determinar scope
        explicit_scope = RAGScope(rag_scope_str) if rag_scope_str else None
        scope = self.router.route(
            doc_type=result.doc_type.value,
            client_id=client_id,
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
            drive_file_id=result.drive_file_id,
            supabase_doc_id=result.supabase_doc_id,
            ler_codes_found=result.metadata.get("ler_codes_found", []),
            warnings=result.extraction_warnings,
        )

    async def _ingest_excel(
        self,
        file_bytes: bytes,
        filename: str,
        client_id: Optional[str],
        project_id: Optional[str],
        rag_scope_str: Optional[str],
        drive_upload: bool,
    ) -> IngestionResult:

        # Determinar scope antes de procesar
        # (el Excel siempre lleva scope en sus chunks desde el procesador)
        explicit_scope = RAGScope(rag_scope_str) if rag_scope_str else None
        scope = self.router.route(
            doc_type="costes_anuales",   # valor provisional, se refinará
            client_id=client_id,
            project_id=project_id,
            explicit_scope=explicit_scope,
        )

        result = await self.excel_processor.process(
            excel_bytes=file_bytes,
            client_id=client_id or "general",
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
            "client_id": client_id,
            "titulo": filename,
            "tipo": result.excel_type.value,
            "naturaleza_pdf": "excel",
            "total_paginas": len(result.sheets),
            "total_chunks": len(result.chunks),
            "tablas_encontradas": len(result.sheets),
            "metadata": {
                **result.metadata,
                "rag_scope": scope.value,
                "project_id": project_id,
            },
            "estado": "indexado",
        }
        await sb.table("client_documents").upsert(doc_data).execute()

        # Guardar chunks con embeddings
        await self.storage.save_chunks_to_supabase(result.chunks, result.doc_id)

        # Poblar tablas estructuradas desde los datos del Excel
        await self._populate_structured_tables(sb, result, client_id, project_id)

        # Subir a Drive
        drive_file_id = None
        if drive_upload and client_id:
            from .pdf_pipeline import DocType
            drive_file_id = await self.storage.upload_to_drive(
                file_bytes, filename, client_id,
                DocType.DESCONOCIDO,  # se muestra en carpeta del tipo de Excel
            )

        return IngestionResult(
            success=True,
            doc_id=result.doc_id,
            filename=filename,
            doc_type=result.excel_type.value,
            rag_scope=scope.value,
            num_chunks=len(result.chunks),
            drive_file_id=drive_file_id,
            supabase_doc_id=result.doc_id,
            ler_codes_found=result.metadata.get("ler_codes_found", []),
            warnings=result.warnings,
        )

    async def _update_chunk_scope(self, chunks, scope: RAGScope, project_id: Optional[str]):
        """Actualiza el scope y project_id en los metadatos de los chunks."""
        for chunk in chunks:
            chunk.metadata["rag_scope"] = scope.value
            if project_id:
                chunk.metadata["project_id"] = project_id

    async def _populate_structured_tables(self, sb, result, client_id, project_id):
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
                inventory_data = {
                    "client_id": client_id,
                    "codigo_ler": row.get("codigo_ler"),
                    "descripcion": row.get("descripcion"),
                    "cantidad_anual_ton": row.get("cantidad_ton"),
                    "precio_actual_eur_ton": row.get("precio_eur_ton"),
                    "fuente_doc_id": result.doc_id,
                    "año": row.get("año"),
                }
                # Quitar None values
                inventory_data = {k: v for k, v in inventory_data.items() if v is not None}

                if inventory_data.get("codigo_ler") or inventory_data.get("descripcion"):
                    await sb.table("waste_inventory").upsert(inventory_data).execute()

                # Si hay importe total, también a invoice_lines para tracking financiero
                if row.get("importe_eur"):
                    await sb.table("invoice_lines").upsert({
                        "client_id": client_id,
                        "doc_id": result.doc_id,
                        "codigo_ler": row.get("codigo_ler"),
                        "descripcion": row.get("descripcion"),
                        "cantidad_toneladas": row.get("cantidad_ton"),
                        "precio_unitario": row.get("precio_eur_ton"),
                        "importe_eur": row.get("importe_eur"),
                    }).execute()

        logger.info(f"Tablas estructuradas pobladas desde Excel: {result.filename}")
