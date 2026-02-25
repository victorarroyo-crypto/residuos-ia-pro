"""
CONFIGURACIÓN Y SERVICIO DE EMBEDDINGS
=======================================
"""

import logging
import asyncio
from dataclasses import dataclass
from openai import AsyncOpenAI
from .pdf_pipeline import DocumentChunk, PipelineConfig

logger = logging.getLogger(__name__)

EMBEDDING_MODEL = "text-embedding-3-large"
EMBEDDING_DIMENSIONS = 1536
EMBED_BATCH_SIZE = 50  # OpenAI permite hasta 2048
EMBED_RETRIES = 3

# Reranking con Claude Haiku (post-retrieval)
RERANK_MODEL = "claude-haiku-4-5-20251001"
RERANK_MAX_TOKENS = 256
RERANK_CANDIDATE_MULTIPLIER = 3  # Pedir 3x más candidatos del SQL para reranking


@dataclass
class PipelineConfigImpl(PipelineConfig):
    anthropic_api_key: str = ""
    openai_api_key: str = ""
    supabase_url: str = ""
    supabase_service_key: str = ""


class EmbeddingService:
    """Genera embeddings con OpenAI en lotes eficientes."""

    def __init__(self, config: PipelineConfig):
        self.client = AsyncOpenAI(api_key=config.openai_api_key)

    async def embed_all(self, chunks: list[DocumentChunk]) -> list[DocumentChunk]:
        """Genera embeddings para todos los chunks en lotes."""
        for i in range(0, len(chunks), EMBED_BATCH_SIZE):
            batch = chunks[i:i + EMBED_BATCH_SIZE]
            texts = [c.content for c in batch]

            response = await self._embed_with_retry(texts, i)
            if response is None:
                logger.error(f"Batch {i}: agotados retries de embedding")
                continue

            for j, embedding_data in enumerate(response.data):
                batch[j].embedding = embedding_data.embedding

        embedded = sum(1 for c in chunks if c.embedding is not None)
        logger.info(f"Embeddings: {embedded}/{len(chunks)} chunks")
        return chunks

    async def _embed_with_retry(self, texts: list[str], batch_start: int):
        delays = [1, 2, 4]
        last_error: Exception | None = None

        for attempt in range(1, EMBED_RETRIES + 1):
            try:
                return await self.client.embeddings.create(
                    model=EMBEDDING_MODEL,
                    input=texts,
                    dimensions=EMBEDDING_DIMENSIONS,
                )
            except Exception as e:
                last_error = e
                logger.warning(
                    f"Batch {batch_start}: intento {attempt}/{EMBED_RETRIES} fallido: {e}"
                )
                if attempt < EMBED_RETRIES:
                    await asyncio.sleep(delays[min(attempt - 1, len(delays) - 1)])

        logger.error(f"Batch {batch_start}: no se pudieron generar embeddings: {last_error}")
        return None
