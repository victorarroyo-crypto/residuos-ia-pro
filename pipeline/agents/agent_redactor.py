"""
AGENTE REDACTOR - Generacion de informe ejecutivo
====================================================
Toma todos los hallazgos y oportunidades y genera un
informe ejecutivo en Markdown.
"""

import logging
from .state import AnalysisState
from .prompts import SYSTEM_REDACTOR
from .llm import call_claude

logger = logging.getLogger(__name__)


def _build_redactor_context(state: AnalysisState) -> str:
    """Construye el contexto completo para el informe."""
    pd = state.get("project_data", {})
    project = pd.get("project", {})
    inventory = pd.get("inventory", [])

    sections = []
    sections.append("=== FICHA DEL INFORME ===")
    sections.append("Tipo de informe: Diagnostico tecnico de gestion de residuos")
    sections.append("Norma de salida: Estandar consultoria medioambiental (Espana)")
    sections.append("")

    sections.append(f"PROYECTO: {project.get('nombre', 'N/A')}")
    sections.append(f"CIF: {project.get('cif', 'N/A')}")
    sections.append(f"SECTOR: {project.get('sector', 'N/A')}")
    sections.append(f"CNAE: {project.get('cnae', 'N/A')}")
    sections.append(f"CCAA: {project.get('comunidad_autonoma', 'N/A')}")
    sections.append(f"MUNICIPIO: {project.get('municipio', 'N/A')}")
    sections.append("")

    # Datos cuantitativos
    if inventory:
        total_cost = sum(
            (i.get("cantidad_anual_ton") or 0) * (i.get("precio_actual_eur_ton") or 0)
            for i in inventory
        )
        total_tons = sum(i.get("cantidad_anual_ton") or 0 for i in inventory)
        sections.append(f"RESUMEN OPERATIVO:")
        sections.append(f"- {len(inventory)} tipos de residuos")
        sections.append(f"- {sum(1 for i in inventory if i.get('peligroso'))} peligrosos")
        sections.append(f"- {total_tons:,.1f} toneladas/ano totales")
        sections.append(f"- {total_cost:,.0f} EUR/ano coste gestion")
        sections.append("")

        # Distribucion por peligrosidad para el analisis ejecutivo
        tons_peligrosos = sum(
            (i.get("cantidad_anual_ton") or 0) for i in inventory if i.get("peligroso")
        )
        tons_no_peligrosos = total_tons - tons_peligrosos
        sections.append("DISTRIBUCION OPERATIVA:")
        sections.append(f"- Toneladas peligrosas: {tons_peligrosos:,.1f} t/ano")
        sections.append(f"- Toneladas no peligrosas: {tons_no_peligrosos:,.1f} t/ano")
        sections.append("")

    # Todos los hallazgos agrupados por severidad
    all_findings = []
    for key in ("aai_findings", "contratos_findings", "facturas_findings", "registro_findings", "normativo_findings"):
        all_findings.extend(state.get(key, []))

    if all_findings:
        severity_order = {"critica": 0, "alta": 1, "media": 2, "baja": 3, "info": 4}
        all_findings.sort(key=lambda f: severity_order.get(f.get("severidad", "info"), 5))

        sections.append(f"=== HALLAZGOS ({len(all_findings)} total) ===")
        for f in all_findings:
            ahorro = f.get("ahorro_eur_ano", 0)
            ahorro_str = f" | Ahorro potencial: {ahorro:,.0f} EUR/ano" if ahorro else ""
            norma_str = f" | {f.get('norma')}" if f.get("norma") else ""
            sections.append(
                f"- [{f.get('severidad', 'info').upper()}] [{f.get('agente', 'N/A')}] "
                f"{f.get('descripcion', 'N/A')}{ahorro_str}{norma_str}"
            )
        sections.append("")

        by_severity = {"critica": 0, "alta": 0, "media": 0, "baja": 0, "info": 0}
        for finding in all_findings:
            sev = str(finding.get("severidad", "info")).lower()
            by_severity[sev if sev in by_severity else "info"] += 1

        sections.append("RESUMEN DE RIESGO:")
        sections.append(
            "- Hallazgos por severidad: "
            f"critica={by_severity['critica']}, alta={by_severity['alta']}, "
            f"media={by_severity['media']}, baja={by_severity['baja']}, info={by_severity['info']}"
        )
        sections.append("")

    # Oportunidades priorizadas
    opportunities = state.get("opportunities", [])
    if opportunities:
        total_savings = sum(o.get("ahorro_eur_ano", 0) for o in opportunities)
        total_investment = sum(o.get("inversion_eur", 0) for o in opportunities)
        sections.append(f"=== OPORTUNIDADES DE AHORRO ({len(opportunities)}) ===")
        sections.append(f"AHORRO TOTAL POTENCIAL: {total_savings:,.0f} EUR/ano")
        sections.append(f"INVERSION TOTAL ESTIMADA: {total_investment:,.0f} EUR")
        sections.append("")
        for i, o in enumerate(opportunities, 1):
            inv = o.get("inversion_eur", 0)
            inv_str = f" | Inversion: {inv:,.0f} EUR" if inv else ""
            payback = o.get("datos", {}).get("payback_meses")
            payback_str = f" | Payback: {payback} meses" if payback else ""
            sections.append(
                f"{i}. [{o.get('tipo', 'N/A')}] {o.get('descripcion', 'N/A')} "
                f"| {o.get('ahorro_eur_ano', 0):,.0f} EUR/ano{inv_str}{payback_str}"
            )

    # Errores que informar
    errors = state.get("errors", [])
    if errors:
        sections.append("")
        sections.append(f"=== LIMITACIONES DEL ANALISIS ===")
        for e in errors:
            sections.append(f"- {e}")

    return "\n".join(sections)


async def agent_redactor(state: AnalysisState) -> dict:
    """Nodo del agente redactor."""
    errors = list(state.get("errors", []))
    context = _build_redactor_context(state)

    try:
        report = await call_claude(
            api_key=state["anthropic_api_key"],
            system_prompt=SYSTEM_REDACTOR,
            user_message=context,
            expect_json=False,
            max_tokens=6000,
        )

        logger.info(f"Agente Redactor: informe generado ({len(str(report))} chars)")
        return {"report": report, "errors": errors}

    except Exception as e:
        logger.error(f"Error en agente Redactor: {e}")
        errors.append(f"Agente Redactor: {e}")
        return {"report": "Error generando el informe ejecutivo.", "errors": errors}
