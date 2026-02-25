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
MAX_EMBED_WORDS = 6000  # ~8000 tokens; límite OpenAI es 8192 tokens

# Reranking con Claude Haiku (post-retrieval)
RERANK_MODEL = "claude-haiku-4-5-20251001"
RERANK_MAX_TOKENS = 256
RERANK_CANDIDATE_MULTIPLIER = 3  # Pedir 3x más candidatos del SQL para reranking


@dataclass
class PipelineConfigImpl(PipelineConfig):
    anthropic_api_key: str = ""
    openai_api_key: str = ""
    gemini_api_key: str = ""
    supabase_url: str = ""
    supabase_service_key: str = ""


class EmbeddingService:
    """Genera embeddings con OpenAI en lotes eficientes."""

    def __init__(self, config: PipelineConfig):
        self.client = AsyncOpenAI(api_key=config.openai_api_key)

    async def embed_all(self, chunks: list[DocumentChunk]) -> list[DocumentChunk]:
        """Genera embeddings para todos los chunks en lotes."""
        # Subdividir chunks que excedan el límite de tokens de OpenAI
        chunks = self._split_oversized_chunks(chunks)

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

    def _split_oversized_chunks(self, chunks: list[DocumentChunk]) -> list[DocumentChunk]:
        """Subdivide chunks que excedan MAX_EMBED_WORDS con ventana deslizante."""
        result = []
        for chunk in chunks:
            words = chunk.content.split()
            if len(words) <= MAX_EMBED_WORDS:
                result.append(chunk)
                continue

            logger.warning(
                f"Chunk {chunk.chunk_id} excede límite: {len(words)} palabras → subdividiendo"
            )
            size = MAX_EMBED_WORDS
            overlap = 200
            i = 0
            sub_idx = 0
            while i < len(words):
                sub_content = " ".join(words[i:i + size])
                if sub_content.strip():
                    result.append(DocumentChunk(
                        chunk_id=f"{chunk.chunk_id}_p{sub_idx:02d}",
                        doc_id=chunk.doc_id,
                        content=sub_content,
                        chunk_index=chunk.chunk_index,
                        page_start=chunk.page_start,
                        page_end=chunk.page_end,
                        chunk_type=chunk.chunk_type,
                        metadata=chunk.metadata,
                    ))
                    sub_idx += 1
                i += size - overlap
            logger.info(f"Chunk {chunk.chunk_id} → {sub_idx} sub-chunks")

        if len(result) != len(chunks):
            logger.info(f"Chunks tras subdivisión: {len(chunks)} → {len(result)}")
        return result

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
