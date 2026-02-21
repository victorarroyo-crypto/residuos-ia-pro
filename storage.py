"""
SERVICIO DE ALMACENAMIENTO
===========================
Persiste todo en Supabase: metadatos en PostgreSQL y archivos originales
en Supabase Storage con estructura organizada por cliente y tipo de documento.

Storage:  documentos/{client_id}/{tipo_doc}/{filename}
          documentos/general/Normativa/{filename}

Supabase: client_documents + document_chunks (con embeddings pgvector)
"""

import logging
from datetime import datetime
from typing import Optional

from supabase import AsyncClient, acreate_client

from .pdf_pipeline import DocType, DocumentChunk, ProcessedDocument, PipelineConfig

logger = logging.getLogger(__name__)

# Bucket de Supabase Storage
STORAGE_BUCKET = "documentos"

# Subcarpetas por tipo de documento (misma organización que antes tenía Drive)
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
        self, filename: str, client_id: str, doc_type: DocType
    ) -> str:
        """
        Construye el path dentro del bucket:
          {client_id}/{tipo_doc}/{filename}
          general/Normativa/{filename}
        """
        folder = DOC_TYPE_FOLDERS.get(doc_type, "_Sin_Clasificar")

        if doc_type == DocType.NORMATIVA:
            return f"general/{folder}/{filename}"

        return f"{client_id}/{folder}/{filename}"

    async def upload_file(
        self,
        file_bytes: bytes,
        filename: str,
        client_id: str,
        doc_type: DocType,
    ) -> str:
        """
        Sube el archivo original a Supabase Storage.
        Retorna el storage_path para guardarlo en client_documents.
        """
        sb = await self._get_supabase()
        storage_path = self._build_storage_path(filename, client_id, doc_type)

        # Detectar mimetype básico
        ext = filename.rsplit(".", 1)[-1].lower() if "." in filename else ""
        mime_map = {
            "pdf": "application/pdf",
            "xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            "xls": "application/vnd.ms-excel",
            "csv": "text/csv",
        }
        content_type = mime_map.get(ext, "application/octet-stream")

        sb.storage.from_(STORAGE_BUCKET).upload(
            path=storage_path,
            file=file_bytes,
            file_options={"content-type": content_type, "upsert": "true"},
        )

        logger.info(f"Archivo subido a Storage: {STORAGE_BUCKET}/{storage_path}")
        return storage_path

    async def get_download_url(self, storage_path: str, expires_in: int = 3600) -> str:
        """Genera una URL firmada temporal para descargar el documento original."""
        sb = await self._get_supabase()
        result = sb.storage.from_(STORAGE_BUCKET).create_signed_url(
            storage_path, expires_in
        )
        return result["signedURL"]

    async def delete_file(self, storage_path: str):
        """Elimina un archivo del Storage."""
        sb = await self._get_supabase()
        sb.storage.from_(STORAGE_BUCKET).remove([storage_path])
        logger.info(f"Archivo eliminado de Storage: {storage_path}")

    # ──────────────────────────────────────────────────
    # SUPABASE POSTGRESQL (metadatos + chunks)
    # ──────────────────────────────────────────────────

    async def save_to_supabase(self, doc: ProcessedDocument) -> str:
        """Guarda el documento procesado en la tabla client_documents."""
        sb = await self._get_supabase()

        data = {
            "id": doc.doc_id,
            "client_id": doc.client_id,
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

        await sb.table("client_documents").upsert(data).execute()
        logger.info(f"Documento guardado en Supabase: {doc.doc_id}")

        await self._save_structured_metadata(sb, doc)

        return doc.doc_id

    async def save_chunks_to_supabase(
        self, chunks: list[DocumentChunk], doc_id: str
    ):
        """Guarda todos los chunks con sus embeddings en document_chunks."""
        sb = await self._get_supabase()

        batch_size = 100
        for i in range(0, len(chunks), batch_size):
            batch = chunks[i:i + batch_size]
            data = [
                {
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
                for chunk in batch
                if chunk.embedding is not None
            ]
            if data:
                await sb.table("document_chunks").upsert(data).execute()

        logger.info(f"{len(chunks)} chunks guardados en Supabase para doc {doc_id}")

    async def _save_structured_metadata(self, sb: AsyncClient, doc: ProcessedDocument):
        """
        Pobla tablas estructuradas con los metadatos extraídos.
        Esto es lo que permite el análisis automático sin releer los PDFs.
        """
        meta = doc.metadata

        # Contratos → tabla contracts
        if doc.doc_type == DocType.CONTRATO and "servicios_contratados" in meta:
            for servicio in meta.get("servicios_contratados", []):
                if servicio.get("codigo_ler"):
                    await sb.table("waste_inventory").upsert({
                        "client_id": doc.client_id,
                        "codigo_ler": servicio["codigo_ler"],
                        "descripcion": servicio.get("descripcion_residuo"),
                        "precio_actual_eur_ton": servicio.get("precio_eur_tonelada"),
                        "operacion": servicio.get("operacion"),
                        "fuente_doc_id": doc.doc_id,
                    }).execute()

        # Facturas → tabla invoice_lines (para tracking de costes)
        if doc.doc_type == DocType.FACTURA and "lineas_servicio" in meta:
            for linea in meta.get("lineas_servicio", []):
                await sb.table("invoice_lines").upsert({
                    "client_id": doc.client_id,
                    "doc_id": doc.doc_id,
                    "fecha": meta.get("fecha_factura"),
                    "codigo_ler": linea.get("codigo_ler"),
                    "descripcion": linea.get("descripcion"),
                    "cantidad_toneladas": linea.get("cantidad_toneladas"),
                    "precio_unitario": linea.get("precio_unitario_eur"),
                    "importe_eur": linea.get("importe_eur"),
                }).execute()

        # Registro → alertas de almacenamiento excedido
        if doc.doc_type == DocType.REGISTRO:
            alertas = meta.get("alertas_almacenamiento", [])
            for alerta in alertas:
                await sb.table("compliance_alerts").upsert({
                    "client_id": doc.client_id,
                    "tipo": "almacenamiento_excedido",
                    "descripcion": f"Posible exceso de tiempo de almacenamiento: {alerta}",
                    "severidad": "alta",
                    "doc_id": doc.doc_id,
                    "estado": "pendiente",
                }).execute()
