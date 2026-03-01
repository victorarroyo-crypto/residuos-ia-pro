"""
PIPELINE DE PROCESAMIENTO DE PDFs - ResidusIA Pro
==================================================
Gestiona todos los casos problemáticos:
  - PDFs escaneados (OCR automático)
  - Documentos muy largos (chunking semántico inteligente)
  - PDFs con contraseña (desencriptado + alerta)
  - Tablas en AAIs y contratos (extracción estructurada)
  - Clasificación automática del tipo de documento
"""

import asyncio
import hashlib
import logging
from dataclasses import dataclass, field
from enum import Enum
from pathlib import Path
from typing import Optional

logger = logging.getLogger(__name__)


# ─────────────────────────────────────────────
# CLASES BASE (importadas por todos los módulos)
# ─────────────────────────────────────────────
@dataclass
class PipelineConfig:
    anthropic_api_key: str = ""
    openai_api_key: str = ""
    supabase_url: str = ""
    supabase_service_key: str = ""


class ContentExtractor:
    """Base class for content extraction."""
    pass


# ─────────────────────────────────────────────
# TIPOS DE DOCUMENTO (clasificación automática)
# ─────────────────────────────────────────────
class DocType(str, Enum):
    AAI            = "autorizacion_ambiental_integrada"
    DARI           = "declaracion_anual_residuos"
    CONTRATO       = "contrato_gestor"
    FACTURA        = "factura"
    REGISTRO       = "registro_produccion"
    PERMISO        = "permiso_ambiental"
    MANUAL         = "manual_interno"
    NORMATIVA      = "normativa"
    ANALISIS       = "analisis_residuos"
    CERTIFICACION  = "informe_certificacion"
    RFQ            = "solicitud_cotizacion"
    FDS            = "ficha_seguridad"
    INFORME        = "informe_tecnico"
    PLAN_GESTION   = "plan_gestion"
    DESCONOCIDO    = "desconocido"


class PDFNature(str, Enum):
    DIGITAL        = "digital"       # texto extraíble directamente
    SCANNED        = "scanned"       # imagen, necesita OCR
    HYBRID         = "hybrid"        # mix de páginas digitales y escaneadas
    ENCRYPTED      = "encrypted"     # protegido con contraseña


# ─────────────────────────────────────────────
# ESTRUCTURAS DE DATOS
# ─────────────────────────────────────────────
@dataclass
class PageContent:
    page_num: int
    text: str
    tables: list[dict]          # tablas extraídas estructuradas
    images: list[bytes]         # imágenes para OCR si necesario
    nature: PDFNature
    confidence: float           # confianza del OCR si aplica (0-1)


@dataclass
class DocumentChunk:
    chunk_id: str
    doc_id: str
    content: str
    chunk_index: int
    page_start: int
    page_end: int
    chunk_type: str             # "texto", "tabla", "cabecera"
    metadata: dict = field(default_factory=dict)
    embedding: Optional[list[float]] = None


@dataclass
class ProcessedDocument:
    doc_id: str
    client_id: str
    original_filename: str
    doc_type: DocType
    nature: PDFNature
    total_pages: int
    chunks: list[DocumentChunk]
    tables_found: int
    was_encrypted: bool
    ocr_applied: bool
    ocr_avg_confidence: float
    extraction_warnings: list[str]
    metadata: dict              # fechas, números de expediente, LERs detectados, etc.
    storage_path: Optional[str] = None
    supabase_doc_id: Optional[str] = None


# ─────────────────────────────────────────────
# PIPELINE PRINCIPAL
# ─────────────────────────────────────────────
class PDFPipeline:
    """
    Orquesta todo el proceso desde PDF crudo hasta chunks en Supabase.
    
    Flujo:
      1. detect_nature()     → ¿digital, escaneado, encriptado?
      2. extract_content()   → texto + tablas según naturaleza
      3. classify_doc()      → ¿AAI, contrato, factura, registro...?
      4. chunk_document()    → chunking semántico inteligente
      5. embed_chunks()      → embeddings con OpenAI
      6. store()             → Supabase (PostgreSQL + Storage)
      7. extract_metadata()  → LERs, fechas, importes, gestores detectados
    """

    def __init__(self, config: "PipelineConfig"):
        from .extractor import PDFNatureDetector, ContentExtractorImpl
        from .classifier_chunker import DocumentClassifier, SemanticChunker
        from .config import EmbeddingService
        from .storage import StorageService
        from .metadata_extractor import MetadataExtractor

        self.config = config
        self.detector    = PDFNatureDetector()
        self.extractor   = ContentExtractorImpl(config)
        self.classifier  = DocumentClassifier(config)
        self.chunker     = SemanticChunker(config)
        self.embedder    = EmbeddingService(config)
        self.storage     = StorageService(config)
        self.metadata_ex = MetadataExtractor(config)

    async def process(
        self,
        pdf_bytes: bytes,
        client_id: str,
        filename: str,
        password: Optional[str] = None,
        project_id: Optional[str] = None,
    ) -> ProcessedDocument:
        """
        Punto de entrada único. Recibe el PDF y devuelve el documento procesado
        y almacenado. Lanza eventos de progreso via Supabase Realtime.
        """
        doc_id = self._generate_doc_id(pdf_bytes, client_id)
        warnings = []

        await self._emit_progress(doc_id, "iniciando", 0)

        # ── PASO 1: Detectar naturaleza ──────────────────────────────────
        await self._emit_progress(doc_id, "detectando_tipo", 5)
        nature = await self.detector.detect(pdf_bytes)
        logger.info(f"[{filename}] Naturaleza detectada: {nature}")

        # ── PASO 2: Manejar encriptación ─────────────────────────────────
        if nature == PDFNature.ENCRYPTED:
            if not password:
                # Intentar sin contraseña (algunos PDFs tienen permisos pero no pass real)
                pdf_bytes, success = await self.extractor.try_unlock(pdf_bytes)
                if not success:
                    warnings.append("PDF protegido con contraseña. Proporciona la contraseña para procesarlo.")
                    return self._error_document(doc_id, client_id, filename, warnings)
            else:
                pdf_bytes = await self.extractor.decrypt(pdf_bytes, password)
                warnings.append("Documento desencriptado para procesamiento. El original cifrado se conserva.")
            nature = await self.detector.detect(pdf_bytes)  # re-detectar tras desencriptar

        # ── PASO 3: Extraer contenido ─────────────────────────────────────
        await self._emit_progress(doc_id, "extrayendo_contenido", 15)
        pages, ocr_applied, ocr_confidence = await self.extractor.extract(
            pdf_bytes, nature
        )
        total_pages = len(pages)
        tables_found = sum(len(p.tables) for p in pages)
        logger.info(f"[{filename}] {total_pages} páginas, {tables_found} tablas, OCR={ocr_applied}")

        # ── PASO 4: Clasificar documento ──────────────────────────────────
        await self._emit_progress(doc_id, "clasificando_documento", 35)
        doc_type = await self.classifier.classify(pages, filename, project_id=project_id)
        logger.info(f"[{filename}] Tipo detectado: {doc_type}")

        # ── PASO 5: Chunking semántico ────────────────────────────────────
        await self._emit_progress(doc_id, "fragmentando", 45)
        chunks = await self.chunker.chunk(
            pages=pages,
            doc_type=doc_type,
            doc_id=doc_id,
            filename=filename,
        )
        logger.info(f"[{filename}] {len(chunks)} chunks generados")

        # ── PASO 6: Embeddings ────────────────────────────────────────────
        await self._emit_progress(doc_id, "generando_embeddings", 60)
        chunks = await self.embedder.embed_all(chunks)

        # ── PASO 7: Extraer metadatos estructurados ───────────────────────
        await self._emit_progress(doc_id, "extrayendo_metadatos", 75)
        metadata = await self.metadata_ex.extract(pages, doc_type, client_id, filename=filename)
        # metadata incluye: extracted_title, LERs encontrados, fechas, importes, gestores

        # ── PASO 8: Almacenar ─────────────────────────────────────────────
        await self._emit_progress(doc_id, "almacenando", 85)
        processed = ProcessedDocument(
            doc_id=doc_id,
            client_id=client_id,
            original_filename=filename,
            doc_type=doc_type,
            nature=nature,
            total_pages=total_pages,
            chunks=chunks,
            tables_found=tables_found,
            was_encrypted=(nature == PDFNature.ENCRYPTED),
            ocr_applied=ocr_applied,
            ocr_avg_confidence=ocr_confidence,
            extraction_warnings=warnings,
            metadata=metadata,
        )

        # Subir archivo original a Supabase Storage (no bloquea el pipeline)
        try:
            processed.storage_path = await self.storage.upload_file(
                pdf_bytes, filename, client_id, doc_type
            )
        except Exception as e:
            logger.warning(f"[{filename}] Storage upload omitido: {e}")
            processed.storage_path = None

        is_knowledge = self.storage._is_knowledge(processed)
        processed.supabase_doc_id = await self.storage.save_to_supabase(processed)
        await self.storage.save_chunks_to_supabase(
            chunks, processed.supabase_doc_id,
            is_knowledge=is_knowledge,
            project_id=None if is_knowledge else client_id,
        )

        await self._emit_progress(doc_id, "completado", 100)
        logger.info(f"[{filename}] ✅ Pipeline completado. Doc ID: {doc_id}")

        return processed

    def _generate_doc_id(self, pdf_bytes: bytes, client_id: str) -> str:
        h = hashlib.sha256(pdf_bytes + client_id.encode()).hexdigest()[:16]
        return f"doc_{h}"

    async def _emit_progress(self, doc_id: str, step: str, pct: int):
        """Emite progreso via Supabase Realtime para actualizar la UI en tiempo real."""
        try:
            sb = await self.storage._get_supabase()
            await sb.table("pipeline_progress").upsert({
                "doc_id": doc_id,
                "step": step,
                "percentage": pct,
            }).execute()
        except Exception as e:
            logger.warning(f"No se pudo emitir progreso: {e}")

    def _error_document(self, doc_id, client_id, filename, warnings) -> ProcessedDocument:
        return ProcessedDocument(
            doc_id=doc_id, client_id=client_id, original_filename=filename,
            doc_type=DocType.DESCONOCIDO, nature=PDFNature.ENCRYPTED,
            total_pages=0, chunks=[], tables_found=0,
            was_encrypted=True, ocr_applied=False, ocr_avg_confidence=0.0,
            extraction_warnings=warnings, metadata={},
        )
