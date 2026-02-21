"""
CONFIGURACIÓN Y SERVICIO DE EMBEDDINGS
=======================================
"""

import logging
from dataclasses import dataclass
from openai import AsyncOpenAI
from .pdf_pipeline import DocumentChunk, PipelineConfig

logger = logging.getLogger(__name__)

EMBEDDING_MODEL = "text-embedding-3-large"
EMBEDDING_DIMENSIONS = 1536
EMBED_BATCH_SIZE = 50  # OpenAI permite hasta 2048


@dataclass
class PipelineConfigImpl(PipelineConfig):
    anthropic_api_key: str = ""
    openai_api_key: str = ""
    supabase_url: str = ""
    supabase_service_key: str = ""
    google_drive_credentials_path: str = "credentials.json"


class EmbeddingService:
    """Genera embeddings con OpenAI en lotes eficientes."""

    def __init__(self, config: PipelineConfig):
        self.client = AsyncOpenAI(api_key=config.openai_api_key)

    async def embed_all(self, chunks: list[DocumentChunk]) -> list[DocumentChunk]:
        """Genera embeddings para todos los chunks en lotes."""
        for i in range(0, len(chunks), EMBED_BATCH_SIZE):
            batch = chunks[i:i + EMBED_BATCH_SIZE]
            texts = [c.content for c in batch]

            try:
                response = await self.client.embeddings.create(
                    model=EMBEDDING_MODEL,
                    input=texts,
                    dimensions=EMBEDDING_DIMENSIONS,
                )
                for j, embedding_data in enumerate(response.data):
                    batch[j].embedding = embedding_data.embedding
            except Exception as e:
                logger.error(f"Error generando embeddings batch {i}: {e}")

        embedded = sum(1 for c in chunks if c.embedding is not None)
        logger.info(f"Embeddings: {embedded}/{len(chunks)} chunks")
        return chunks
