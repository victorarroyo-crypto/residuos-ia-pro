"""
HERRAMIENTAS PARA AGENTES - ResidusIA Pro
============================================
Define herramientas que los agentes usan via Claude tool_use
para hacer búsquedas RAG dinámicas durante el análisis.

Dos herramientas disponibles:
- search_knowledge: busca en normativa, BREFs, legislación
- search_project_docs: busca en documentos del proyecto (AAI, contratos, facturas)
"""

import logging
from typing import Any

from openai import AsyncOpenAI
from supabase._async.client import AsyncClient, create_client as acreate_client

logger = logging.getLogger(__name__)

# ─── Definiciones de herramientas (esquemas para Claude API) ───────────

TOOL_SEARCH_KNOWLEDGE = {
    "name": "search_knowledge",
    "description": (
        "Busca en la base de conocimiento normativa: legislación, BREFs, directivas, "
        "guías técnicas de residuos industriales. Usa búsqueda vectorial + texto. "
        "Útil para encontrar obligaciones legales, mejores técnicas disponibles, "
        "benchmarks del sector, y normativa autonómica."
    ),
    "input_schema": {
        "type": "object",
        "properties": {
            "query": {
                "type": "string",
                "description": "Consulta en lenguaje natural (ej: 'obligaciones almacenamiento residuos peligrosos Ley 7/2022')",
            },
            "doc_type": {
                "type": "string",
                "description": "Filtro opcional: normativa, bref, directiva, reglamento, guia, legislacion",
            },
        },
        "required": ["query"],
    },
}

TOOL_SEARCH_PROJECT = {
    "name": "search_project_docs",
    "description": (
        "Busca en los documentos específicos del proyecto: AAI, contratos con gestores, "
        "facturas, registros, declaraciones anuales. Usa búsqueda vectorial + texto. "
        "Útil para encontrar cláusulas específicas, datos concretos, o verificar detalles."
    ),
    "input_schema": {
        "type": "object",
        "properties": {
            "query": {
                "type": "string",
                "description": "Consulta (ej: 'cláusulas de penalización por incumplimiento')",
            },
            "doc_type": {
                "type": "string",
                "description": "Filtro opcional: contrato_gestor, factura, autorizacion_ambiental_integrada, declaracion_anual_residuos",
            },
        },
        "required": ["query"],
    },
}

# Conjuntos de herramientas por agente
NORMATIVO_TOOLS = [TOOL_SEARCH_KNOWLEDGE, TOOL_SEARCH_PROJECT]
CONTRATOS_TOOLS = [TOOL_SEARCH_PROJECT, TOOL_SEARCH_KNOWLEDGE]
FACTURAS_TOOLS = [TOOL_SEARCH_PROJECT]


class ToolExecutor:
    """Ejecuta herramientas de búsqueda RAG contra Supabase."""

    _EMBED_MODEL = "text-embedding-3-large"
    _EMBED_DIMS = 1536
    _MATCH_THRESHOLD = 0.50
    _MATCH_COUNT = 10

    def __init__(
        self,
        supabase_url: str,
        supabase_key: str,
        openai_api_key: str,
        project_id: str = "",
    ):
        self._sb_url = supabase_url
        self._sb_key = supabase_key
        self._project_id = project_id
        self._openai = AsyncOpenAI(api_key=openai_api_key)
        self._sb: AsyncClient | None = None

    async def _get_sb(self) -> AsyncClient:
        if not self._sb:
            self._sb = await acreate_client(self._sb_url, self._sb_key)
        return self._sb

    async def execute(self, tool_name: str, tool_input: dict[str, Any]) -> str:
        """Ejecuta una herramienta y devuelve resultado como texto."""
        handlers = {
            "search_knowledge": self._search_knowledge,
            "search_project_docs": self._search_project_docs,
        }
        handler = handlers.get(tool_name)
        if not handler:
            return f"Herramienta '{tool_name}' no reconocida."

        try:
            return await handler(tool_input)
        except Exception as e:
            logger.error(f"Error ejecutando tool {tool_name}: {e}")
            return f"Error al ejecutar {tool_name}: {e}"

    async def _embed(self, text: str) -> list[float]:
        response = await self._openai.embeddings.create(
            model=self._EMBED_MODEL,
            input=text,
            dimensions=self._EMBED_DIMS,
        )
        return response.data[0].embedding

    async def _search_knowledge(self, params: dict) -> str:
        query = params["query"]
        doc_type = params.get("doc_type")

        embedding = await self._embed(query)
        sb = await self._get_sb()

        result = await sb.rpc(
            "search_knowledge",
            {
                "query_embedding": embedding,
                "doc_type_filter": doc_type,
                "match_threshold": self._MATCH_THRESHOLD,
                "match_count": self._MATCH_COUNT,
                "query_text": query,
            },
        ).execute()

        rows = result.data or []
        if not rows:
            return f"No se encontró normativa relevante para: '{query}'"

        sections = [f"=== BASE DE CONOCIMIENTO ({len(rows)} fragmentos) ==="]
        for r in rows:
            score = r.get("hybrid_score", r.get("similarity", 0))
            sections.append(
                f"\n[{r.get('doc_tipo', 'N/A')} | {r.get('doc_titulo', 'Sin título')} | Score: {score:.2f}]\n"
                f"{r.get('contenido', '')[:2000]}"
            )
        return "\n".join(sections)

    async def _search_project_docs(self, params: dict) -> str:
        query = params["query"]
        doc_type = params.get("doc_type")

        if not self._project_id:
            return "No hay project_id configurado para buscar documentos del proyecto."

        embedding = await self._embed(query)
        sb = await self._get_sb()

        result = await sb.rpc(
            "search_project",
            {
                "query_embedding": embedding,
                "p_project_id": self._project_id,
                "doc_type_filter": doc_type,
                "match_threshold": self._MATCH_THRESHOLD,
                "match_count": self._MATCH_COUNT,
                "query_text": query,
            },
        ).execute()

        rows = result.data or []
        if not rows:
            return f"No se encontraron documentos del proyecto para: '{query}'"

        sections = [f"=== DOCUMENTOS DEL PROYECTO ({len(rows)} fragmentos) ==="]
        for r in rows:
            score = r.get("hybrid_score", r.get("similarity", 0))
            sections.append(
                f"\n[{r.get('doc_tipo', 'N/A')} | {r.get('doc_titulo', 'Sin título')} | Score: {score:.2f}]\n"
                f"{r.get('contenido', '')[:2000]}"
            )
        return "\n".join(sections)
