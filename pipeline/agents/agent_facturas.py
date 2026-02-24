"""
AGENTE FACTURAS - Analisis de anomalias financieras
=====================================================
Analiza facturas de gestion de residuos para detectar
anomalias de precio, cantidad y tendencias.
"""

import logging
from .state import AnalysisState, Finding
from .prompts import SYSTEM_FACTURAS, build_instructions_block, build_agent_focus_block, build_previous_findings_block
from .llm import call_claude

logger = logging.getLogger(__name__)


def _build_facturas_context(state: AnalysisState) -> str:
    """Construye el contexto para el agente de facturas."""
    pd = state.get("project_data", {})
    project = pd.get("project", {})
    invoice_lines = pd.get("invoice_lines", [])
    contracts = pd.get("contracts", [])
    inventory = pd.get("inventory", [])
    documents = pd.get("documents", [])
    chunks = pd.get("chunks", [])

    # Chunks de facturas
    factura_docs = [d for d in documents if d.get("tipo") == "factura"]
    factura_doc_ids = {d["id"] for d in factura_docs}
    factura_chunks = [c for c in chunks if c.get("document_id") in factura_doc_ids]

    sections = []
    sections.append(f"PROYECTO: {project.get('nombre', 'N/A')}")
    sections.append("")

    if invoice_lines:
        sections.append(f"=== LINEAS DE FACTURA ({len(invoice_lines)}) ===")
        for line in invoice_lines:
            sections.append(
                f"- Fecha: {line.get('fecha', 'N/A')} | LER: {line.get('codigo_ler', 'N/A')} | "
                f"{line.get('descripcion', 'N/A')} | "
                f"{line.get('cantidad_toneladas', 'N/A')} t | "
                f"{line.get('precio_unitario', 'N/A')} EUR/t | "
                f"Importe: {line.get('importe_eur', 'N/A')} EUR"
            )
        sections.append("")

    if factura_chunks:
        sections.append(f"=== CONTENIDO DE FACTURAS ({len(factura_chunks)} fragmentos) ===")
        for chunk in factura_chunks[:20]:
            sections.append(f"[{chunk.get('chunk_type', 'texto')}] {chunk.get('contenido', '')[:1500]}")
            sections.append("---")
        sections.append("")

    if contracts:
        sections.append(f"=== PRECIOS CONTRATADOS (referencia) ===")
        for c in contracts:
            sections.append(
                f"- LERs: {c.get('codigos_ler', [])} | "
                f"Precio contratado: {c.get('precio_eur_ton', 'N/A')} EUR/t"
            )
        sections.append("")

    if inventory:
        sections.append(f"=== INVENTARIO (cantidades declaradas) ===")
        for item in inventory:
            sections.append(
                f"- LER {item.get('codigo_ler')} | "
                f"{item.get('cantidad_anual_ton', 'N/A')} t/ano declaradas | "
                f"{item.get('precio_actual_eur_ton', 'N/A')} EUR/t"
            )

    if not invoice_lines and not factura_chunks:
        sections.append("NO HAY FACTURAS INDEXADAS PARA ESTE PROYECTO.")
        sections.append("Indica que no se puede realizar el analisis financiero sin facturas.")

    # Inyectar instrucciones HITL
    hitl = build_instructions_block(state) + build_agent_focus_block(state, "facturas") + build_previous_findings_block(state, "facturas")
    if hitl:
        sections.insert(0, hitl)

    return "\n".join(sections)


async def agent_facturas(state: AnalysisState) -> dict:
    """Nodo del agente de facturas."""
    errors = list(state.get("errors", []))
    context = _build_facturas_context(state)

    try:
        result = await call_claude(
            api_key=state["anthropic_api_key"],
            system_prompt=SYSTEM_FACTURAS,
            user_message=context,
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
                agente="facturas",
                datos=f.get("datos", {}),
            ))

        logger.info(f"Agente Facturas: {len(findings)} hallazgos")
        return {"facturas_findings": findings, "errors": errors}

    except Exception as e:
        logger.error(f"Error en agente Facturas: {e}")
        errors.append(f"Agente Facturas: {e}")
        return {"facturas_findings": [], "errors": errors}
