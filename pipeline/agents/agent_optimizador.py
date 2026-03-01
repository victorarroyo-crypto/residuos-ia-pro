"""
AGENTE OPTIMIZADOR - Priorizacion de oportunidades de ahorro
===============================================================
Cruza hallazgos de todos los agentes para generar oportunidades
de ahorro priorizadas por EUR/ano.
"""

import logging
from .state import AnalysisState, Finding
from .prompts import SYSTEM_OPTIMIZADOR
from .llm import call_claude, routing_kwargs

logger = logging.getLogger(__name__)


def _build_optimizador_context(state: AnalysisState) -> str:
    """Construye el contexto con todos los hallazgos previos."""
    pd = state.get("project_data", {})
    project = pd.get("project", {})
    inventory = pd.get("inventory", [])

    sections = []
    sections.append(f"PROYECTO: {project.get('nombre', 'N/A')}")
    sections.append(f"SECTOR: {project.get('sector', 'N/A')}")
    sections.append("")

    # Resumen de costes actuales
    if inventory:
        total_cost = sum(
            (i.get("cantidad_anual_ton") or 0) * (i.get("precio_actual_eur_ton") or 0)
            for i in inventory
        )
        sections.append(f"COSTE ANUAL TOTAL DE GESTION DE RESIDUOS: {total_cost:,.0f} EUR/ano")
        sections.append(f"TOTAL RESIDUOS: {len(inventory)}")
        sections.append(f"PELIGROSOS: {sum(1 for i in inventory if i.get('peligroso'))}")
        sections.append("")

    # Hallazgos de cada agente
    agent_findings = {
        "AAI": state.get("aai_findings", []),
        "CONTRATOS": state.get("contratos_findings", []),
        "FACTURAS": state.get("facturas_findings", []),
        "REGISTRO": state.get("registro_findings", []),
        "NORMATIVO": state.get("normativo_findings", []),
    }

    for agent_name, findings in agent_findings.items():
        if findings:
            sections.append(f"=== HALLAZGOS {agent_name} ({len(findings)}) ===")
            for f in findings:
                ahorro = f.get("ahorro_eur_ano", 0)
                ahorro_str = f" | Ahorro: {ahorro:,.0f} EUR/ano" if ahorro else ""
                sections.append(
                    f"- [{f.get('severidad', 'info').upper()}] {f.get('descripcion', 'N/A')}"
                    f"{ahorro_str}"
                )
                if f.get("norma"):
                    sections.append(f"  Base legal: {f['norma']}")
            sections.append("")

    if not any(agent_findings.values()):
        sections.append("No se encontraron hallazgos de los agentes especializados.")
        sections.append("Genera recomendaciones generales basadas en el perfil del proyecto.")

    return "\n".join(sections)


async def agent_optimizador(state: AnalysisState) -> dict:
    """Nodo del agente optimizador."""
    errors = list(state.get("errors", []))
    context = _build_optimizador_context(state)

    try:
        result = await call_claude(
            api_key=state["anthropic_api_key"],
            system_prompt=SYSTEM_OPTIMIZADOR,
            user_message=context,
            **routing_kwargs(state),
        )

        opportunities: list[Finding] = []
        for f in result.get("opportunities", []):
            opportunities.append(Finding(
                tipo=f.get("tipo", "info"),
                descripcion=f.get("descripcion", ""),
                severidad=f.get("severidad", "info"),
                ahorro_eur_ano=f.get("ahorro_eur_ano", 0),
                inversion_eur=f.get("inversion_eur", 0),
                norma=f.get("norma", ""),
                agente="optimizador",
                datos=f.get("datos", {}),
            ))

        # Ordenar por ahorro descendente
        opportunities.sort(key=lambda x: x.get("ahorro_eur_ano", 0), reverse=True)

        logger.info(f"Agente Optimizador: {len(opportunities)} oportunidades")
        return {"opportunities": opportunities, "errors": errors}

    except Exception as e:
        logger.error(f"Error en agente Optimizador: {e}")
        errors.append(f"Agente Optimizador: {e}")
        return {"opportunities": [], "errors": errors}
