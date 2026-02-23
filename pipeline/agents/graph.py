"""
GRAFO DE ANALISIS - LangGraph
================================
Define el grafo dirigido que orquesta todos los agentes.

Flujo:
  load_project_data
        |
        v
  [AAI, Contratos, Facturas, Registro, Normativo]  (paralelo)
        |
        v
    Optimizador
        |
        v
     Redactor
"""

import asyncio
import logging
from typing import Any

from langgraph.graph import StateGraph, END

from .state import AnalysisState
from .loader import load_project_data
from .agent_aai import agent_aai
from .agent_contratos import agent_contratos
from .agent_facturas import agent_facturas
from .agent_registro import agent_registro
from .agent_normativo import agent_normativo
from .agent_optimizador import agent_optimizador
from .agent_redactor import agent_redactor

logger = logging.getLogger(__name__)


# ─── Wrappers sync para nodos que son async ─────────────────────────

def _run_async(coro):
    """Ejecuta una corrutina en un nuevo event loop si no hay uno activo."""
    try:
        loop = asyncio.get_running_loop()
    except RuntimeError:
        loop = None

    if loop and loop.is_running():
        import concurrent.futures
        with concurrent.futures.ThreadPoolExecutor() as pool:
            return pool.submit(asyncio.run, coro).result()
    else:
        return asyncio.run(coro)


def _node_load(state: AnalysisState) -> dict:
    return load_project_data(state)


def _node_aai(state: AnalysisState) -> dict:
    return _run_async(agent_aai(state))


def _node_contratos(state: AnalysisState) -> dict:
    return _run_async(agent_contratos(state))


def _node_facturas(state: AnalysisState) -> dict:
    return _run_async(agent_facturas(state))


def _node_registro(state: AnalysisState) -> dict:
    return _run_async(agent_registro(state))


def _node_normativo(state: AnalysisState) -> dict:
    return _run_async(agent_normativo(state))


def _node_optimizador(state: AnalysisState) -> dict:
    return _run_async(agent_optimizador(state))


def _node_redactor(state: AnalysisState) -> dict:
    return _run_async(agent_redactor(state))


def _should_continue_after_load(state: AnalysisState) -> str:
    """Si no hay datos del proyecto, ir directo al redactor con error."""
    pd = state.get("project_data", {})
    if not pd.get("project"):
        return "redactor"
    return "analysis"


# ─── Fan-out node: ejecuta los 5 agentes en paralelo ────────────────

def _node_parallel_analysis(state: AnalysisState) -> dict:
    """Ejecuta AAI, Contratos, Facturas, Registro y Normativo en paralelo."""

    async def _run_all():
        results = await asyncio.gather(
            agent_aai(state),
            agent_contratos(state),
            agent_facturas(state),
            agent_registro(state),
            agent_normativo(state),
            return_exceptions=True,
        )
        return results

    results = _run_async(_run_all())

    # Merge results
    merged: dict[str, Any] = {"errors": list(state.get("errors", []))}
    keys = ["aai_findings", "contratos_findings", "facturas_findings", "registro_findings", "normativo_findings"]

    for i, key in enumerate(keys):
        result = results[i]
        if isinstance(result, Exception):
            merged["errors"].append(f"Error en agente {key}: {result}")
            merged[key] = []
        elif isinstance(result, dict):
            merged[key] = result.get(key, [])
            merged["errors"].extend(result.get("errors", []))
        else:
            merged[key] = []

    return merged


# ─── Construccion del grafo ──────────────────────────────────────────

def build_analysis_graph() -> StateGraph:
    """Construye y compila el grafo de analisis."""
    graph = StateGraph(AnalysisState)

    # Nodos
    graph.add_node("load", _node_load)
    graph.add_node("analysis", _node_parallel_analysis)
    graph.add_node("optimizador", _node_optimizador)
    graph.add_node("redactor", _node_redactor)

    # Edges
    graph.set_entry_point("load")
    graph.add_conditional_edges(
        "load",
        _should_continue_after_load,
        {"analysis": "analysis", "redactor": "redactor"},
    )
    graph.add_edge("analysis", "optimizador")
    graph.add_edge("optimizador", "redactor")
    graph.add_edge("redactor", END)

    return graph.compile()


async def run_project_analysis(
    project_id: str,
    supabase_url: str,
    supabase_key: str,
    anthropic_api_key: str,
    openai_api_key: str = "",
) -> dict:
    """Ejecuta el analisis completo de un proyecto.

    Retorna dict con:
      - report: str (informe Markdown)
      - findings: list[Finding] (todos los hallazgos)
      - opportunities: list[Finding] (oportunidades priorizadas)
      - errors: list[str]
    """
    graph = build_analysis_graph()

    initial_state: AnalysisState = {
        "project_id": project_id,
        "supabase_url": supabase_url,
        "supabase_key": supabase_key,
        "anthropic_api_key": anthropic_api_key,
        "openai_api_key": openai_api_key,
        "errors": [],
    }

    logger.info(f"Iniciando analisis del proyecto {project_id}")

    # Invoke el grafo sincronamente (LangGraph maneja internamente)
    final_state = graph.invoke(initial_state)

    # Agrupar todos los hallazgos
    all_findings = []
    for key in ("aai_findings", "contratos_findings", "facturas_findings", "registro_findings", "normativo_findings"):
        all_findings.extend(final_state.get(key, []))

    result = {
        "report": final_state.get("report", ""),
        "findings": all_findings,
        "opportunities": final_state.get("opportunities", []),
        "errors": final_state.get("errors", []),
        "aai_findings": final_state.get("aai_findings", []),
        "contratos_findings": final_state.get("contratos_findings", []),
        "facturas_findings": final_state.get("facturas_findings", []),
        "registro_findings": final_state.get("registro_findings", []),
        "normativo_findings": final_state.get("normativo_findings", []),
    }

    logger.info(
        f"Analisis completado: {len(all_findings)} hallazgos, "
        f"{len(result['opportunities'])} oportunidades, "
        f"{len(result['errors'])} errores"
    )

    return result
