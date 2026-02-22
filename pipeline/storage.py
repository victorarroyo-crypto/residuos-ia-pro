"""
SERVICIO DE ALMACENAMIENTO
===========================
Persiste todo en Supabase: metadatos en PostgreSQL y archivos originales
en Supabase Storage con estructura organizada por proyecto y tipo de documento.

Storage:  documentos/{project_id}/{tipo_doc}/{filename}
          documentos/general/Normativa/{filename}

Supabase: Dos RAGs separados:
  knowledge_documents + knowledge_chunks  (normativa, BREFs, directivas)
  project_documents   + project_chunks    (docs de proyecto)
"""

import logging
import re
from datetime import datetime
from typing import Optional

from supabase._async.client import AsyncClient, create_client as acreate_client

from .pdf_pipeline import DocType, DocumentChunk, ProcessedDocument, PipelineConfig

logger = logging.getLogger(__name__)

# Bucket de Supabase Storage
STORAGE_BUCKET = "documentos"

# Subcarpetas por tipo de documento
DOC_TYPE_FOLDERS = {
    DocType.AAI:         "AAI_Autorizaciones",
    DocType.DARI:        "DARI_Declaraciones",
    DocType.CONTRATO:    "Contratos_Gestores",
    DocType.FACTURA:     "Facturas",
    DocType.REGISTRO:    "Registros_Produccion",
    DocType.PERMISO:     "Permisos",
    DocType.NORMATIVA:   "Normativa",
    DocType.MANUAL:      "Manuales",
    DocType.DESCONOCIDO: "_Sin_Clasificar",
}

# Tipos de documento que van al RAG general (knowledge)
KNOWLEDGE_DOC_TYPES = {DocType.NORMATIVA}

_uuid_re = re.compile(
    r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$", re.I
)


class StorageService:

    def __init__(self, config: PipelineConfig):
        self.config = config
        self._supabase: Optional[AsyncClient] = None

    # ──────────────────────────────────────────────────
    # SUPABASE CLIENT
    # ──────────────────────────────────────────────────

    async def _get_supabase(self) -> AsyncClient:
        if not self._supabase:
            self._supabase = await acreate_client(
                self.config.supabase_url,
                self.config.supabase_service_key,
            )
        return self._supabase

    # ──────────────────────────────────────────────────
    # SUPABASE STORAGE (archivos originales)
    # ──────────────────────────────────────────────────

    def _build_storage_path(
        self, filename: str, project_id: str, doc_type: DocType
    ) -> str:
        folder = DOC_TYPE_FOLDERS.get(doc_type, "_Sin_Clasificar")

        if doc_type in KNOWLEDGE_DOC_TYPES:
            return f"general/{folder}/{filename}"

        return f"{project_id}/{folder}/{filename}"

    async def upload_file(
        self,
        file_bytes: bytes,
        filename: str,
        project_id: str,
        doc_type: DocType,
    ) -> str:
        sb = await self._get_supabase()
        storage_path = self._build_storage_path(filename, project_id, doc_type)

        ext = filename.rsplit(".", 1)[-1].lower() if "." in filename else ""
        mime_map = {
            "pdf": "application/pdf",
            "xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            "xls": "application/vnd.ms-excel",
            "csv": "text/csv",
        }
        content_type = mime_map.get(ext, "application/octet-stream")

        try:
            await sb.storage.from_(STORAGE_BUCKET).upload(
                path=storage_path,
                file=file_bytes,
                file_options={"content-type": content_type, "upsert": "true"},
            )
            logger.info(f"Archivo subido a Storage: {STORAGE_BUCKET}/{storage_path}")
        except Exception as e:
            logger.error(f"Error subiendo archivo a Storage: {e}")
            raise

        return storage_path

    async def get_download_url(self, storage_path: str, expires_in: int = 3600) -> str:
        sb = await self._get_supabase()
        result = await sb.storage.from_(STORAGE_BUCKET).create_signed_url(
            storage_path, expires_in
        )
        return result["signedURL"]

    async def delete_file(self, storage_path: str):
        sb = await self._get_supabase()
        await sb.storage.from_(STORAGE_BUCKET).remove([storage_path])
        logger.info(f"Archivo eliminado de Storage: {storage_path}")

    # ──────────────────────────────────────────────────
    # HELPERS: ¿es knowledge o project?
    # ──────────────────────────────────────────────────

    def _is_knowledge(self, doc: ProcessedDocument) -> bool:
        return doc.doc_type in KNOWLEDGE_DOC_TYPES

    # ──────────────────────────────────────────────────
    # SUPABASE POSTGRESQL (metadatos + chunks)
    # ──────────────────────────────────────────────────

    async def save_to_supabase(self, doc: ProcessedDocument) -> str:
        """Guarda el documento en knowledge_documents o project_documents."""
        sb = await self._get_supabase()

        if self._is_knowledge(doc):
            return await self._save_knowledge_doc(sb, doc)
        else:
            return await self._save_project_doc(sb, doc)

    async def _save_knowledge_doc(self, sb: AsyncClient, doc: ProcessedDocument) -> str:
        """Guarda en knowledge_documents (RAG General)."""
        data = {
            "id": doc.doc_id,
            "titulo": doc.original_filename,
            "tipo": self._map_knowledge_tipo(doc.doc_type),
            "naturaleza_pdf": doc.nature.value,
            "total_paginas": doc.total_pages,
            "total_chunks": len(doc.chunks),
            "tablas_encontradas": doc.tables_found,
            "ocr_aplicado": doc.ocr_applied,
            "ocr_confianza_media": doc.ocr_avg_confidence,
            "fue_encriptado": doc.was_encrypted,
            "storage_path": doc.storage_path,
            "advertencias": doc.extraction_warnings,
            "metadata": doc.metadata,
            "estado": "indexado",
            "fecha_ingesta": datetime.utcnow().isoformat(),
            "fecha_documento": doc.metadata.get("fecha_concesion")
                or doc.metadata.get("fecha_inicio"),
        }

        result = await sb.table("knowledge_documents").upsert(data).execute()
        if not result.data:
            raise RuntimeError(f"Fallo al guardar knowledge_documents {doc.doc_id}")
        logger.info(f"Knowledge doc guardado: {doc.doc_id}")
        return doc.doc_id

    async def _save_project_doc(self, sb: AsyncClient, doc: ProcessedDocument) -> str:
        """Guarda en project_documents (RAG Proyecto)."""
        db_project_id = doc.client_id if _uuid_re.match(doc.client_id or "") else None
        if not db_project_id:
            raise RuntimeError(
                f"project_documents requiere project_id válido, recibido: {doc.client_id}"
            )

        data = {
            "id": doc.doc_id,
            "project_id": db_project_id,
            "titulo": doc.original_filename,
            "tipo": doc.doc_type.value,
            "naturaleza_pdf": doc.nature.value,
            "total_paginas": doc.total_pages,
            "total_chunks": len(doc.chunks),
            "tablas_encontradas": doc.tables_found,
            "ocr_aplicado": doc.ocr_applied,
            "ocr_confianza_media": doc.ocr_avg_confidence,
            "fue_encriptado": doc.was_encrypted,
            "storage_path": doc.storage_path,
            "advertencias": doc.extraction_warnings,
            "metadata": doc.metadata,
            "estado": "indexado",
            "fecha_ingesta": datetime.utcnow().isoformat(),
            "fecha_documento": doc.metadata.get("fecha_concesion")
                or doc.metadata.get("fecha_factura")
                or doc.metadata.get("fecha_inicio"),
            "fecha_vencimiento": doc.metadata.get("fecha_vencimiento"),
        }

        result = await sb.table("project_documents").upsert(data).execute()
        if not result.data:
            raise RuntimeError(f"Fallo al guardar project_documents {doc.doc_id}")
        logger.info(f"Project doc guardado: {doc.doc_id}")

        await self._save_structured_metadata(sb, doc)
        return doc.doc_id

    async def save_chunks_to_supabase(
        self, chunks: list[DocumentChunk], doc_id: str, is_knowledge: bool = False,
        project_id: str = None,
    ):
        """Guarda chunks en knowledge_chunks o project_chunks."""
        sb = await self._get_supabase()
        table = "knowledge_chunks" if is_knowledge else "project_chunks"

        batch_size = 100
        for i in range(0, len(chunks), batch_size):
            batch = chunks[i:i + batch_size]
            data = []
            for chunk in batch:
                if chunk.embedding is None:
                    continue
                row = {
                    "id": chunk.chunk_id,
                    "document_id": doc_id,
                    "chunk_index": chunk.chunk_index,
                    "contenido": chunk.content,
                    "embedding": chunk.embedding,
                    "chunk_type": chunk.chunk_type,
                    "page_start": chunk.page_start,
                    "page_end": chunk.page_end,
                    "tokens": len(chunk.content.split()),
                    "metadata": chunk.metadata,
                }
                if not is_knowledge:
                    row["project_id"] = project_id
                data.append(row)

            if data:
                result = await sb.table(table).upsert(data).execute()
                if not result.data:
                    raise RuntimeError(f"Fallo chunks (batch {i}) para doc {doc_id} en {table}")

        logger.info(f"{len(chunks)} chunks guardados en {table} para doc {doc_id}")

    def _map_knowledge_tipo(self, doc_type: DocType) -> str:
        """Mapea DocType del pipeline al tipo de knowledge_documents.

        Tipos alineados con estructura Google Drive:
          legislacion, documentacion_tecnica, gestores_residuos,
          clasificacion_residuos, gestion_operativa, referencia
        """
        mapping = {
            DocType.NORMATIVA: "legislacion",
        }
        return mapping.get(doc_type, "desconocido")

    async def _save_structured_metadata(self, sb: AsyncClient, doc: ProcessedDocument):
        """Pobla tablas estructuradas con metadatos extraídos de docs de proyecto."""
        meta = doc.metadata

        if doc.doc_type == DocType.CONTRATO and "servicios_contratados" in meta:
            for servicio in meta.get("servicios_contratados", []):
                if servicio.get("codigo_ler"):
                    await sb.table("waste_inventory").upsert({
                        "project_id": doc.client_id,
                        "codigo_ler": servicio["codigo_ler"],
                        "descripcion": servicio.get("descripcion_residuo"),
                        "precio_actual_eur_ton": servicio.get("precio_eur_tonelada"),
                        "operacion": servicio.get("operacion"),
                        "fuente_doc_id": doc.doc_id,
                    }).execute()

        if doc.doc_type == DocType.FACTURA and "lineas_servicio" in meta:
            for linea in meta.get("lineas_servicio", []):
                await sb.table("invoice_lines").upsert({
                    "project_id": doc.client_id,
                    "doc_id": doc.doc_id,
                    "fecha": meta.get("fecha_factura"),
                    "codigo_ler": linea.get("codigo_ler"),
                    "descripcion": linea.get("descripcion"),
                    "cantidad_toneladas": linea.get("cantidad_toneladas"),
                    "precio_unitario": linea.get("precio_unitario_eur"),
                    "importe_eur": linea.get("importe_eur"),
                }).execute()

        if doc.doc_type == DocType.REGISTRO:
            alertas = meta.get("alertas_almacenamiento", [])
            for alerta in alertas:
                await sb.table("compliance_alerts").upsert({
                    "project_id": doc.client_id,
                    "tipo": "almacenamiento_excedido",
                    "descripcion": f"Posible exceso de tiempo de almacenamiento: {alerta}",
                    "severidad": "alta",
                    "doc_id": doc.doc_id,
                    "estado": "pendiente",
                }).execute()
