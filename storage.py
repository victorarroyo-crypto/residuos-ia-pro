"""
SERVICIO DE ALMACENAMIENTO
===========================
Persiste todo en Supabase y Google Drive de forma organizada.

Drive:  RAG_Residuos_Industriales/Clientes/{cliente}/tipo_doc/
        RAG_Residuos_Industriales/Normativa/nivel/

Supabase: client_documents + document_chunks (con embeddings pgvector)
"""

import io
import json
import logging
from datetime import datetime
from typing import Optional

from supabase import AsyncClient, acreate_client
from google.oauth2.service_account import Credentials
from googleapiclient.discovery import build
from googleapiclient.http import MediaIoBaseUpload

from .pdf_pipeline import DocType, DocumentChunk, ProcessedDocument, PipelineConfig

logger = logging.getLogger(__name__)

# Carpeta raíz en Drive
DRIVE_ROOT_FOLDER = "RAG_Residuos_Industriales"

# Subcarpetas por tipo de documento
DRIVE_DOC_FOLDERS = {
    DocType.AAI:      "AAI_Autorizaciones",
    DocType.DARI:     "DARI_Declaraciones",
    DocType.CONTRATO: "Contratos_Gestores",
    DocType.FACTURA:  "Facturas",
    DocType.REGISTRO: "Registros_Produccion",
    DocType.PERMISO:  "Permisos",
    DocType.NORMATIVA:"Normativa",
    DocType.MANUAL:   "Manuales",
    DocType.DESCONOCIDO: "_Sin_Clasificar",
}


class StorageService:

    def __init__(self, config: PipelineConfig):
        self.config = config
        self._supabase: Optional[AsyncClient] = None
        self._drive = None
        self._folder_cache: dict[str, str] = {}  # path → drive_folder_id

    # ──────────────────────────────────────────────────────
    # SUPABASE
    # ──────────────────────────────────────────────────────

    async def _get_supabase(self) -> AsyncClient:
        if not self._supabase:
            self._supabase = await acreate_client(
                self.config.supabase_url,
                self.config.supabase_service_key,
            )
        return self._supabase

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
            "drive_file_id": doc.drive_file_id,
            "advertencias": doc.extraction_warnings,
            "metadata": doc.metadata,
            "estado": "indexado",
            "fecha_ingesta": datetime.utcnow().isoformat(),
            # Campos de fechas extraídos por el metadata extractor
            "fecha_documento": doc.metadata.get("fecha_concesion")
                or doc.metadata.get("fecha_factura")
                or doc.metadata.get("fecha_inicio"),
            "fecha_vencimiento": doc.metadata.get("fecha_vencimiento"),
        }

        result = await sb.table("client_documents").upsert(data).execute()
        logger.info(f"Documento guardado en Supabase: {doc.doc_id}")

        # Guardar también los metadatos estructurados en tablas específicas
        await self._save_structured_metadata(sb, doc)

        return doc.doc_id

    async def save_chunks_to_supabase(
        self, chunks: list[DocumentChunk], doc_id: str
    ):
        """Guarda todos los chunks con sus embeddings en document_chunks."""
        sb = await self._get_supabase()

        # Insertar en lotes de 100 para no sobrecargar
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

    # ──────────────────────────────────────────────────────
    # GOOGLE DRIVE
    # ──────────────────────────────────────────────────────

    def _get_drive_service(self):
        if not self._drive:
            creds = Credentials.from_service_account_file(
                self.config.google_drive_credentials_path,
                scopes=["https://www.googleapis.com/auth/drive"],
            )
            self._drive = build("drive", "v3", credentials=creds)
        return self._drive

    async def upload_to_drive(
        self,
        pdf_bytes: bytes,
        filename: str,
        client_id: str,
        doc_type: DocType,
    ) -> str:
        """
        Sube el PDF a Drive en la carpeta correcta:
        RAG_Residuos_Industriales/Clientes/{client_name}/{tipo_doc}/
        """
        drive = self._get_drive_service()

        # Obtener nombre del cliente
        sb = await self._get_supabase()
        client_result = await sb.table("clients").select("nombre").eq("id", client_id).execute()
        client_name = client_result.data[0]["nombre"] if client_result.data else client_id

        # Asegurar que existe la estructura de carpetas
        folder_path = f"{DRIVE_ROOT_FOLDER}/Clientes/{client_name}/{DRIVE_DOC_FOLDERS[doc_type]}"
        folder_id = await self._ensure_folder_path(drive, folder_path)

        # Subir archivo
        file_metadata = {
            "name": filename,
            "parents": [folder_id],
        }
        media = MediaIoBaseUpload(
            io.BytesIO(pdf_bytes),
            mimetype="application/pdf",
            resumable=True,
        )
        file = drive.files().create(
            body=file_metadata,
            media_body=media,
            fields="id, webViewLink",
        ).execute()

        logger.info(f"Subido a Drive: {folder_path}/{filename} → {file['id']}")
        return file["id"]

    async def _ensure_folder_path(self, drive, path: str) -> str:
        """
        Crea recursivamente la estructura de carpetas en Drive si no existe.
        Usa caché para no hacer llamadas redundantes.
        """
        if path in self._folder_cache:
            return self._folder_cache[path]

        parts = path.split("/")
        parent_id = "root"

        for i, part in enumerate(parts):
            current_path = "/".join(parts[:i + 1])
            if current_path in self._folder_cache:
                parent_id = self._folder_cache[current_path]
                continue

            # Buscar si ya existe
            query = (
                f"name='{part}' and "
                f"'{parent_id}' in parents and "
                f"mimeType='application/vnd.google-apps.folder' and "
                f"trashed=false"
            )
            results = drive.files().list(q=query, fields="files(id)").execute()
            files = results.get("files", [])

            if files:
                folder_id = files[0]["id"]
            else:
                folder_metadata = {
                    "name": part,
                    "mimeType": "application/vnd.google-apps.folder",
                    "parents": [parent_id],
                }
                folder = drive.files().create(
                    body=folder_metadata, fields="id"
                ).execute()
                folder_id = folder["id"]
                logger.info(f"Carpeta Drive creada: {current_path}")

            self._folder_cache[current_path] = folder_id
            parent_id = folder_id

        return parent_id
