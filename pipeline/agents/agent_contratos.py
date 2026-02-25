"""
AGENTE CONTRATOS - Analisis de contratos con gestores
=======================================================
Analiza contratos para detectar vencimientos, precios
fuera de mercado y gestores no autorizados.
"""

import logging
from .state import AnalysisState, Finding
from .prompts import SYSTEM_CONTRATOS, build_instructions_block, build_agent_focus_block, build_previous_findings_block
from .llm import call_claude_with_tools
from .tools import CONTRATOS_TOOLS, ToolExecutor

logger = logging.getLogger(__name__)


def _build_contratos_context(state: AnalysisState) -> str:
    """Construye el contexto para el agente de contratos."""
    pd = state.get("project_data", {})
    project = pd.get("project", {})
    contracts = pd.get("contracts", [])
    managers = pd.get("managers", [])
    inventory = pd.get("inventory", [])
    documents = pd.get("documents", [])
    chunks = pd.get("chunks", [])

    # Chunks de contratos
    contrato_docs = [d for d in documents if d.get("tipo") == "contrato_gestor"]
    contrato_doc_ids = {d["id"] for d in contrato_docs}
    contrato_chunks = [c for c in chunks if c.get("document_id") in contrato_doc_ids]

    manager_map = {m["id"]: m for m in managers}

    sections = []
    sections.append(f"PROYECTO: {project.get('nombre', 'N/A')}")
    sections.append(f"SECTOR: {project.get('sector', 'N/A')}")
    sections.append("")

    if contracts:
        sections.append(f"=== CONTRATOS ({len(contracts)}) ===")
        for c in contracts:
            mgr = manager_map.get(c.get("manager_id"), {})
            sections.append(
                f"- Gestor: {mgr.get('nombre', 'N/A')} (NIF: {mgr.get('nif', 'N/A')})"
                f"\n  LERs: {c.get('codigos_ler', [])}"
                f"\n  Precio: {c.get('precio_eur_ton', 'N/A')} EUR/t"
                f"\n  Inicio: {c.get('fecha_inicio', 'N/A')} | Vencimiento: {c.get('fecha_vencimiento', 'N/A')}"
                f"\n  Alertar {c.get('alertar_dias_antes', 30)} dias antes"
                f"\n  Autorizaciones gestor: {mgr.get('operaciones_autorizadas', [])}"
                f"\n  LERs autorizados gestor: {mgr.get('codigos_ler_autorizados', [])}"
            )
        sections.append("")

    if contrato_chunks:
        sections.append(f"=== CONTENIDO DE CONTRATOS ({len(contrato_chunks)} fragmentos) ===")
        for chunk in contrato_chunks[:20]:
            sections.append(f"[{chunk.get('chunk_type', 'texto')}] {chunk.get('contenido', '')[:1500]}")
            sections.append("---")
        sections.append("")

    if inventory:
        sections.append(f"=== INVENTARIO DE RESIDUOS ({len(inventory)}) ===")
        for item in inventory:
            pelig = "PELIGROSO" if item.get("peligroso") else "No peligroso"
            sections.append(
                f"- LER {item.get('codigo_ler')} | {item.get('descripcion', 'N/A')} | "
                f"{pelig} | {item.get('cantidad_anual_ton', 'N/A')} t/ano | "
                f"{item.get('precio_actual_eur_ton', 'N/A')} EUR/t | "
                f"Gestor: {item.get('gestor_actual', 'N/A')}"
            )

    if not contracts and not contrato_chunks:
        sections.append("NO HAY CONTRATOS INDEXADOS PARA ESTE PROYECTO.")
        sections.append("Analiza el inventario de residuos para detectar residuos sin contrato visible.")

    sections.append("")
    sections.append(
        "Puedes usar search_project_docs para buscar cláusulas específicas en contratos "
        "y search_knowledge para consultar benchmarks de precios y normativa de gestores."
    )

    # Inyectar instrucciones HITL
    hitl = build_instructions_block(state) + build_agent_focus_block(state, "contratos") + build_previous_findings_block(state, "contratos")
    if hitl:
        sections.insert(0, hitl)

    return "\n".join(sections)


async def agent_contratos(state: AnalysisState) -> dict:
    """Nodo del agente de contratos con tool use."""
    errors = list(state.get("errors", []))
    context = _build_contratos_context(state)

    executor = ToolExecutor(
        supabase_url=state["supabase_url"],
        supabase_key=state["supabase_key"],
        openai_api_key=state.get("openai_api_key", ""),
        project_id=state.get("project_id", ""),
    )

    try:
        result = await call_claude_with_tools(
            api_key=state["anthropic_api_key"],
            system_prompt=SYSTEM_CONTRATOS,
            user_message=context,
            tools=CONTRATOS_TOOLS,
            tool_executor=executor,
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
                agente="contratos",
                datos=f.get("datos", {}),
            ))

        logger.info(f"Agente Contratos: {len(findings)} hallazgos")
        return {"contratos_findings": findings, "errors": errors}

    except Exception as e:
        logger.error(f"Error en agente Contratos: {e}")
        errors.append(f"Agente Contratos: {e}")
        return {"contratos_findings": [], "errors": errors}
