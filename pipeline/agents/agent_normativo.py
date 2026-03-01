"""
AGENTE NORMATIVO - Consulta RAG de base de conocimiento
=========================================================
Usa herramientas de búsqueda RAG (search_knowledge, search_project_docs)
para buscar normativa aplicable al sector y CCAA del proyecto.

A diferencia del resto de agentes, el normativo busca información
dinámicamente usando tool_use en vez de recibir todo el contexto
precargado. Esto le permite hacer múltiples búsquedas dirigidas.
"""

import logging
from .state import AnalysisState, Finding
from .prompts import SYSTEM_NORMATIVO, build_instructions_block, build_agent_focus_block, build_previous_findings_block
from .llm import call_claude_with_tools, routing_kwargs
from .tools import NORMATIVO_TOOLS, ToolExecutor

logger = logging.getLogger(__name__)


def _build_normativo_context(state: AnalysisState) -> str:
    """Construye el contexto del proyecto (sin RAG, Claude buscará con tools)."""
    pd = state.get("project_data", {})
    project = pd.get("project", {})
    inventory = pd.get("inventory", [])

    sections = []
    sections.append(f"PROYECTO: {project.get('nombre', 'N/A')}")
    sections.append(f"SECTOR: {project.get('sector', 'N/A')}")
    sections.append(f"CNAE: {project.get('cnae', 'N/A')}")
    sections.append(f"CCAA: {project.get('comunidad_autonoma', 'N/A')}")
    sections.append(f"MUNICIPIO: {project.get('municipio', 'N/A')}")
    sections.append("")

    if inventory:
        sections.append(f"=== RESIDUOS DEL PROYECTO ({len(inventory)}) ===")
        for item in inventory:
            pelig = "PELIGROSO" if item.get("peligroso") else "No peligroso"
            sections.append(
                f"- LER {item.get('codigo_ler')} | {item.get('descripcion', 'N/A')} | {pelig}"
            )
        sections.append("")

    sections.append(
        "Usa las herramientas search_knowledge y search_project_docs para buscar "
        "normativa aplicable, BREFs del sector, obligaciones legales y documentos "
        "del proyecto. Haz varias búsquedas dirigidas para cubrir todos los aspectos."
    )

    # Inyectar instrucciones HITL
    hitl = build_instructions_block(state) + build_agent_focus_block(state, "normativo") + build_previous_findings_block(state, "normativo")
    if hitl:
        sections.insert(0, hitl)

    return "\n".join(sections)


async def agent_normativo(state: AnalysisState) -> dict:
    """Nodo del agente normativo con tool use."""
    errors = list(state.get("errors", []))
    context = _build_normativo_context(state)

    executor = ToolExecutor(
        supabase_url=state["supabase_url"],
        supabase_key=state["supabase_key"],
        openai_api_key=state.get("openai_api_key", ""),
        project_id=state.get("project_id", ""),
    )

    try:
        result = await call_claude_with_tools(
            api_key=state["anthropic_api_key"],
            system_prompt=SYSTEM_NORMATIVO,
            user_message=context,
            tools=NORMATIVO_TOOLS,
            tool_executor=executor,
            **routing_kwargs(state),
        )

        findings: list[Finding] = []
        for f in result.get("findings", []):
            findings.append(Finding(
                tipo=f.get("tipo", "info"),
                descripcion=f.get("descripcion", ""),
                severidad=f.get("severidad", "info"),
                ahorro_eur_ano=f.get("ahorro_eur_ano", 0),
                inversion_eur=f.get("inversion_eur", 0),
                norma=f.get("norma", ""),
                agente="normativo",
                datos=f.get("datos", {}),
            ))

        logger.info(f"Agente Normativo: {len(findings)} hallazgos")
        return {"normativo_findings": findings, "errors": errors}

    except Exception as e:
        logger.error(f"Error en agente Normativo: {e}")
        errors.append(f"Agente Normativo: {e}")
        return {"normativo_findings": [], "errors": errors}
