"""
SISTEMA DE SCOPING DEL RAG - ResidusIA Pro
===========================================
Gestiona dos RAGs completamente separados:

  KNOWLEDGE (base de conocimiento)
  ────────────────────────────────
  • Tablas: knowledge_documents + knowledge_chunks
  • Normativa europea, nacional y autonómica
  • BREFs y guías técnicas
  • Disponible para TODOS los consultores.
  • Los documentos vienen de Google Drive.

  PROJECT (documentos de proyecto)
  ──────────────────────────────────
  • Tablas: project_documents + project_chunks
  • AAI, contratos, facturas, registros de UN proyecto
  • Excels de costes y presupuestos
  • Solo accesible desde ese proyecto concreto.

La función de búsqueda combina ambos RAGs cuando es útil,
pero siempre son tablas separadas — imposible mezclar datos.
"""

import logging
from dataclasses import dataclass
from enum import Enum
from typing import Optional

from openai import AsyncOpenAI
from supabase._async.client import AsyncClient, create_client as acreate_client

logger = logging.getLogger(__name__)


class RAGScope(str, Enum):
    GENERAL  = "general"   # knowledge_documents/chunks
    PROJECT  = "project"   # project_documents/chunks


@dataclass
class RAGSearchResult:
    chunk_id: str
    document_id: str
    content: str
    chunk_type: str
    similarity: float
    doc_title: str
    doc_type: str
    rag_scope: RAGScope
    storage_path: Optional[str]
    metadata: dict
    text_rank: float = 0.0
    hybrid_score: float = 0.0


@dataclass
class RAGResponse:
    query: str
    results: list[RAGSearchResult]
    general_results: list[RAGSearchResult]   # de knowledge base
    project_results: list[RAGSearchResult]   # de docs del proyecto
    context_text: str                        # texto listo para pasar al LLM


class RAGScopingService:
    """
    Servicio central de búsqueda RAG con dos fuentes separadas.

    Las búsquedas se hacen en paralelo:
    1. search_knowledge() → normativa, BREFs (tablas knowledge_*)
    2. search_project()   → docs del proyecto (tablas project_*)

    El contexto combina ambos, etiquetados claramente.
    """

    def __init__(self, config):
        self.config = config
        self.openai = AsyncOpenAI(api_key=config.openai_api_key)
        self._supabase: Optional[AsyncClient] = None

    async def _get_supabase(self) -> AsyncClient:
        if not self._supabase:
            self._supabase = await acreate_client(
                self.config.supabase_url,
                self.config.supabase_service_key,
            )
        return self._supabase

    async def search(
        self,
        query: str,
        project_id: Optional[str] = None,
        scopes: list[RAGScope] = None,
        doc_type_filter: Optional[str] = None,
        top_k_per_scope: int = 5,
        similarity_threshold: float = 0.70,
    ) -> RAGResponse:
        if scopes is None:
            scopes = [RAGScope.GENERAL, RAGScope.PROJECT]

        query_embedding = await self._embed(query)

        general_results = []
        project_results = []

        # Buscar en knowledge base (normativa, BREFs)
        if RAGScope.GENERAL in scopes:
            general_results = await self._search_knowledge(
                query_embedding=query_embedding,
                query_text=query,
                doc_type_filter=doc_type_filter,
                top_k=top_k_per_scope,
                threshold=similarity_threshold,
            )

        # Buscar en docs del proyecto
        if RAGScope.PROJECT in scopes and project_id:
            project_results = await self._search_project(
                query_embedding=query_embedding,
                query_text=query,
                project_id=project_id,
                doc_type_filter=doc_type_filter,
                top_k=top_k_per_scope,
                threshold=similarity_threshold,
            )

        all_results = sorted(
            general_results + project_results,
            key=lambda r: r.hybrid_score,
            reverse=True,
        )
        context_text = self._build_context(query, general_results, project_results)

        return RAGResponse(
            query=query,
            results=all_results,
            general_results=general_results,
            project_results=project_results,
            context_text=context_text,
        )

    async def _search_knowledge(
        self,
        query_embedding: list[float],
        query_text: str,
        doc_type_filter: Optional[str],
        top_k: int,
        threshold: float,
    ) -> list[RAGSearchResult]:
        """Búsqueda híbrida en knowledge_chunks (vector + full-text)."""
        sb = await self._get_supabase()

        try:
            result = await sb.rpc(
                "search_knowledge",
                {
                    "query_embedding": query_embedding,
                    "doc_type_filter": doc_type_filter,
                    "match_threshold": threshold,
                    "match_count": top_k,
                    "query_text": query_text,
                }
            ).execute()

            return [
                RAGSearchResult(
                    chunk_id=row["chunk_id"],
                    document_id=row["document_id"],
                    content=row["contenido"],
                    chunk_type=row["chunk_type"],
                    similarity=row["similarity"],
                    doc_title=row["doc_titulo"],
                    doc_type=row["doc_tipo"],
                    rag_scope=RAGScope.GENERAL,
                    storage_path=row.get("storage_path"),
                    metadata=row.get("doc_metadata", {}),
                    text_rank=row.get("text_rank", 0.0),
                    hybrid_score=row.get("hybrid_score", row["similarity"]),
                )
                for row in (result.data or [])
            ]
        except Exception as e:
            logger.error(f"Error búsqueda knowledge: {e}")
            return []

    async def _search_project(
        self,
        query_embedding: list[float],
        query_text: str,
        project_id: str,
        doc_type_filter: Optional[str],
        top_k: int,
        threshold: float,
    ) -> list[RAGSearchResult]:
        """Búsqueda híbrida en project_chunks (vector + full-text)."""
        sb = await self._get_supabase()

        try:
            result = await sb.rpc(
                "search_project",
                {
                    "query_embedding": query_embedding,
                    "p_project_id": project_id,
                    "doc_type_filter": doc_type_filter,
                    "match_threshold": threshold,
                    "match_count": top_k,
                    "query_text": query_text,
                }
            ).execute()

            return [
                RAGSearchResult(
                    chunk_id=row["chunk_id"],
                    document_id=row["document_id"],
                    content=row["contenido"],
                    chunk_type=row["chunk_type"],
                    similarity=row["similarity"],
                    doc_title=row["doc_titulo"],
                    doc_type=row["doc_tipo"],
                    rag_scope=RAGScope.PROJECT,
                    storage_path=row.get("storage_path"),
                    metadata=row.get("doc_metadata", {}),
                    text_rank=row.get("text_rank", 0.0),
                    hybrid_score=row.get("hybrid_score", row["similarity"]),
                )
                for row in (result.data or [])
            ]
        except Exception as e:
            logger.error(f"Error búsqueda project: {e}")
            return []

    def _build_context(
        self,
        query: str,
        general_results: list[RAGSearchResult],
        project_results: list[RAGSearchResult],
    ) -> str:
        sections = []
        sections.append(f"CONSULTA: {query}\n")

        if project_results:
            sections.append("=" * 60)
            sections.append("DOCUMENTOS DEL PROYECTO (datos reales):")
            sections.append("=" * 60)
            for r in project_results:
                sections.append(
                    f"\n[{r.doc_type.upper()} | {r.doc_title} | Relevancia: {r.hybrid_score:.2f}]\n"
                    f"{r.content}\n"
                )

        if general_results:
            sections.append("=" * 60)
            sections.append("BASE DE CONOCIMIENTO GENERAL (normativa y benchmarks):")
            sections.append("=" * 60)
            for r in general_results:
                sections.append(
                    f"\n[{r.doc_type.upper()} | {r.doc_title} | Relevancia: {r.hybrid_score:.2f}]\n"
                    f"{r.content}\n"
                )

        if not general_results and not project_results:
            sections.append("No se encontraron documentos relevantes para esta consulta.")

        return "\n".join(sections)

    async def _embed(self, text: str) -> list[float]:
        response = await self.openai.embeddings.create(
            model="text-embedding-3-large",
            input=text,
            dimensions=1536,
        )
        return response.data[0].embedding


class DocumentIngestionRouter:
    """
    Decide si un documento va a knowledge o a project.

    Reglas:
    - Normativa, BREFs, directivas → knowledge
    - Todo lo demás (AAI, contratos, facturas, excels) → project
    """

    KNOWLEDGE_DOC_TYPES = {
        # Tipos nuevos (alineados con estructura Google Drive)
        "legislacion", "documentacion_tecnica", "gestores_residuos",
        "clasificacion_residuos", "gestion_operativa", "referencia",
        # Tipos legacy del clasificador (se mapean a los nuevos al guardar)
        "normativa", "bref", "directiva", "reglamento", "guia",
        "guia_tecnica", "benchmark_precios",
        "estadistica_sectorial", "plan_nacional", "plan_autonomico",
    }

    PROJECT_DOC_TYPES = {
        "autorizacion_ambiental_integrada", "declaracion_anual_residuos",
        "contrato_gestor", "factura", "registro_produccion",
        "permiso_ambiental", "manual_interno",
        "costes_anuales", "inventario_ler", "comparativa_gestores",
        "presupuesto", "auditoria",
    }

    def route(
        self,
        doc_type: str,
        project_id: Optional[str] = None,
        explicit_scope: Optional[RAGScope] = None,
    ) -> RAGScope:
        if explicit_scope:
            return explicit_scope

        if not project_id:
            return RAGScope.GENERAL

        if doc_type in self.KNOWLEDGE_DOC_TYPES:
            return RAGScope.GENERAL

        if doc_type in self.PROJECT_DOC_TYPES:
            return RAGScope.PROJECT

        return RAGScope.PROJECT
