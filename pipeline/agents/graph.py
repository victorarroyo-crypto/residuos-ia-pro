"""
GRAFO DE ANALISIS - LangGraph
================================
Define el grafo dirigido que orquesta los agentes seleccionados
por el consultor.

Flujo:
  load_project_data
        |
        v
  [agentes seleccionados]  (paralelo)
        |
        v
    Optimizador
        |
        v
     Redactor

Los agentes especializados (aai, contratos, facturas, registro, normativo)
son opcionales. El consultor elige cuales ejecutar.
Optimizador y Redactor siempre se ejecutan.
"""

import asyncio
import logging
import time
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
from .agent_coordinador import agent_coordinador

logger = logging.getLogger(__name__)

# Mapa de agentes disponibles
AGENT_MAP = {
    "aai": ("aai_findings", agent_aai),
    "contratos": ("contratos_findings", agent_contratos),
    "facturas": ("facturas_findings", agent_facturas),
    "registro": ("registro_findings", agent_registro),
    "normativo": ("normativo_findings", agent_normativo),
}

ALL_AGENT_IDS = list(AGENT_MAP.keys())

# ─── Progress tracking (via Supabase Realtime) ──────────────────────


def emit_progress(project_id: str, event: dict, supabase_url: str, supabase_key: str):
    """Insert a progress event into analysis_progress table (Supabase Realtime)."""
    if not supabase_url or not supabase_key:
        logger.warning("emit_progress called without Supabase credentials")
        return
    try:
        from supabase import create_client
        sb = create_client(supabase_url, supabase_key)
        sb.table("analysis_progress").insert({
            "project_id": project_id,
            "event_type": event.get("type", "unknown"),
            "agent": event.get("agent"),
            "findings_count": event.get("findings_count"),
        }).execute()
    except Exception as e:
        logger.warning(f"Could not emit analysis progress: {e}")


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
    project_id = state.get("project_id", "")
    sb_url = state.get("supabase_url", "")
    sb_key = state.get("supabase_key", "")
    emit_progress(project_id, {"type": "load_start"}, sb_url, sb_key)
    result = load_project_data(state)
    emit_progress(project_id, {"type": "load_done"}, sb_url, sb_key)
    return result


def _node_optimizador(state: AnalysisState) -> dict:
    project_id = state.get("project_id", "")
    sb_url = state.get("supabase_url", "")
    sb_key = state.get("supabase_key", "")
    emit_progress(project_id, {"type": "agent_start", "agent": "optimizador"}, sb_url, sb_key)
    result = _run_async(agent_optimizador(state))
    emit_progress(project_id, {"type": "agent_done", "agent": "optimizador"}, sb_url, sb_key)
    return result


def _node_redactor(state: AnalysisState) -> dict:
    project_id = state.get("project_id", "")
    sb_url = state.get("supabase_url", "")
    sb_key = state.get("supabase_key", "")
    emit_progress(project_id, {"type": "agent_start", "agent": "redactor"}, sb_url, sb_key)
    result = _run_async(agent_redactor(state))
    emit_progress(project_id, {"type": "agent_done", "agent": "redactor"}, sb_url, sb_key)
    return result


def _should_continue_after_load(state: AnalysisState) -> str:
    """Si no hay datos del proyecto, ir directo al redactor con error."""
    pd = state.get("project_data", {})
    if not pd.get("project"):
        return "redactor"
    return "analysis"


# ─── Fan-out node: ejecuta solo los agentes seleccionados ───────────

def _make_parallel_node(agent_ids: list[str]):
    """Crea un nodo que ejecuta solo los agentes seleccionados en paralelo."""

    def _node_parallel_analysis(state: AnalysisState) -> dict:
        project_id = state.get("project_id", "")
        sb_url = state.get("supabase_url", "")
        sb_key = state.get("supabase_key", "")
        selected = [
            (aid, key, fn)
            for aid in agent_ids
            if aid in AGENT_MAP
            for key, fn in [AGENT_MAP[aid]]
        ]

        if not selected:
            return {"errors": list(state.get("errors", [])) + ["No hay agentes seleccionados"]}

        # Emit agent start events
        for aid, _, _ in selected:
            emit_progress(project_id, {"type": "agent_start", "agent": aid}, sb_url, sb_key)

        async def _run_agent(aid: str, fn):
            result = await fn(state)
            emit_progress(project_id, {
                "type": "agent_done",
                "agent": aid,
                "findings_count": len(result.get(AGENT_MAP[aid][0], [])) if isinstance(result, dict) else 0,
            }, sb_url, sb_key)
            return result

        async def _run_all():
            tasks = [_run_agent(aid, fn) for aid, _, fn in selected]
            return await asyncio.gather(*tasks, return_exceptions=True)

        results = _run_async(_run_all())

        # Merge results
        merged: dict[str, Any] = {"errors": list(state.get("errors", []))}

        # Inicializar todos los findings keys a lista vacia
        for key, _ in AGENT_MAP.values():
            if not isinstance(key, str):
                continue
        for aid in ALL_AGENT_IDS:
            findings_key = AGENT_MAP[aid][0]
            merged[findings_key] = []

        # Rellenar con resultados reales
        for i, (_, findings_key, _) in enumerate(selected):
            result = results[i]
            if isinstance(result, Exception):
                merged["errors"].append(f"Error en agente {findings_key}: {result}")
            elif isinstance(result, dict):
                merged[findings_key] = result.get(findings_key, [])
                merged["errors"].extend(result.get("errors", []))

        return merged

    return _node_parallel_analysis


# ─── Construccion del grafo ──────────────────────────────────────────

def build_analysis_graph(agent_ids: list[str] | None = None) -> StateGraph:
    """Construye y compila el grafo de analisis.

    Args:
        agent_ids: Lista de agentes a ejecutar. None = todos.
                   Valores validos: "aai", "contratos", "facturas", "registro", "normativo"
                   Optimizador y Redactor siempre se ejecutan.
    """
    if agent_ids is None:
        agent_ids = ALL_AGENT_IDS

    # Filtrar solo IDs validos
    agent_ids = [aid for aid in agent_ids if aid in AGENT_MAP]
    if not agent_ids:
        agent_ids = ALL_AGENT_IDS

    logger.info(f"Grafo configurado con agentes: {agent_ids}")

    graph = StateGraph(AnalysisState)

    # Nodos
    graph.add_node("load", _node_load)
    graph.add_node("analysis", _make_parallel_node(agent_ids))
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


async def plan_analysis(
    project_id: str,
    supabase_url: str,
    supabase_key: str,
    anthropic_api_key: str,
) -> dict:
    """Fase 0: Carga datos + coordinador genera plan inteligente.

    Retorna dict con:
      - analysis_plan: AnalysisPlan
      - data_summary: dict
      - errors: list[str]
    """
    state: AnalysisState = {
        "project_id": project_id,
        "supabase_url": supabase_url,
        "supabase_key": supabase_key,
        "anthropic_api_key": anthropic_api_key,
        "errors": [],
    }

    logger.info(f"Planificando analisis para proyecto {project_id}")

    # Paso 1: Cargar datos
    load_result = load_project_data(state)
    state.update(load_result)

    pd = state.get("project_data", {})
    if not pd.get("project"):
        return {"analysis_plan": {}, "errors": state.get("errors", ["Proyecto no encontrado"])}

    # Paso 2: Coordinador genera plan
    coord_result = _run_async(agent_coordinador(state))
    state.update(coord_result)

    plan = state.get("analysis_plan", {})

    return {
        "analysis_plan": plan,
        "project_name": pd.get("project", {}).get("nombre", ""),
        "errors": state.get("errors", []),
    }


async def run_project_analysis(
    project_id: str,
    supabase_url: str,
    supabase_key: str,
    anthropic_api_key: str,
    openai_api_key: str = "",
    gemini_api_key: str = "",
    agents: list[str] | None = None,
    consultant_instructions: str = "",
    agent_focus: dict[str, str] | None = None,
    round_number: int = 1,
    previous_findings: list[dict] | None = None,
    # Model routing
    model_override: str = "",
    tier: str = "standard",
    consultant_id: str = "",
) -> dict:
    """Ejecuta el analisis de un proyecto con los agentes seleccionados.

    Args:
        agents: Lista de agentes a ejecutar. None = todos.
        consultant_instructions: Instrucciones libres del consultor (HITL).
        agent_focus: {agent_id: "foco especifico"} del consultor (HITL).
        round_number: 1 = primera vuelta, 2 = segunda vuelta.
        previous_findings: Hallazgos de ronda anterior (para 2a vuelta).

    Retorna dict con:
      - report: str (informe Markdown)
      - findings: list[Finding] (todos los hallazgos)
      - opportunities: list[Finding] (oportunidades priorizadas)
      - errors: list[str]
      - agents_used: list[str]
    """
    graph = build_analysis_graph(agents)

    used_agents = agents if agents else ALL_AGENT_IDS

    initial_state: AnalysisState = {
        "project_id": project_id,
        "supabase_url": supabase_url,
        "supabase_key": supabase_key,
        "anthropic_api_key": anthropic_api_key,
        "openai_api_key": openai_api_key,
        "gemini_api_key": gemini_api_key,
        "consultant_instructions": consultant_instructions,
        "agent_focus": agent_focus or {},
        "round_number": round_number,
        "previous_findings": previous_findings or [],
        "model_override": model_override,
        "tier": tier,
        "consultant_id": consultant_id,
        "errors": [],
    }

    logger.info(
        f"Iniciando analisis del proyecto {project_id} con agentes: {used_agents}"
        f" | ronda: {round_number}"
        f" | instrucciones: {'si' if consultant_instructions else 'no'}"
    )

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
        "agents_used": used_agents,
        "round_number": round_number,
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

    # Emit completion event
    emit_progress(project_id, {"type": "complete"}, supabase_url, supabase_key)

    return result
