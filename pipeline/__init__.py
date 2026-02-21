"""
ResidusIA Pro - Pipeline de procesamiento de documentos
"""

from .unified_ingestion import UnifiedIngestionService, IngestionResult
from .pdf_pipeline import PDFPipeline, DocType, PDFNature
from .rag_scoping import RAGScopingService, RAGScope
from .config import PipelineConfigImpl, EmbeddingService

__all__ = [
    "UnifiedIngestionService",
    "IngestionResult",
    "PDFPipeline",
    "DocType",
    "PDFNature",
    "RAGScopingService",
    "RAGScope",
    "PipelineConfigImpl",
    "EmbeddingService",
]
