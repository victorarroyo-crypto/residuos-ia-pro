"""
AGENTE AAI - Analisis de Autorizacion Ambiental Integrada
============================================================
Analiza documentos de AAI para extraer LERs autorizados,
detectar incumplimientos y verificar condiciones.
"""

import logging
from .state import AnalysisState, Finding
from .prompts import SYSTEM_AAI, build_instructions_block, build_agent_focus_block, build_previous_findings_block
from .llm import call_claude, routing_kwargs

logger = logging.getLogger(__name__)


def _build_aai_context(state: AnalysisState) -> str:
    """Construye el contexto para el agente AAI."""
    pd = state.get("project_data", {})
    project = pd.get("project", {})
    documents = pd.get("documents", [])
    chunks = pd.get("chunks", [])
    inventory = pd.get("inventory", [])

    # Filtrar documentos y chunks de tipo AAI
    aai_docs = [d for d in documents if d.get("tipo") == "autorizacion_ambiental_integrada"]
    aai_doc_ids = {d["id"] for d in aai_docs}
    aai_chunks = [c for c in chunks if c.get("document_id") in aai_doc_ids]

    sections = []
    sections.append(f"PROYECTO: {project.get('nombre', 'N/A')}")
    sections.append(f"SECTOR: {project.get('sector', 'N/A')}")
    sections.append(f"CNAE: {project.get('cnae', 'N/A')}")
    sections.append(f"CCAA: {project.get('comunidad_autonoma', 'N/A')}")
    sections.append("")

    if aai_docs:
        sections.append(f"=== DOCUMENTOS AAI ({len(aai_docs)}) ===")
        for doc in aai_docs:
            sections.append(f"- {doc.get('titulo', 'Sin titulo')} | Estado: {doc.get('estado')} | Fecha: {doc.get('fecha_documento', 'N/A')}")
        sections.append("")

    if aai_chunks:
        sections.append(f"=== CONTENIDO AAI ({len(aai_chunks)} fragmentos) ===")
        for chunk in aai_chunks[:30]:  # Limitar para no exceder contexto
            sections.append(f"[{chunk.get('chunk_type', 'texto')}] {chunk.get('contenido', '')[:1500]}")
            sections.append("---")
        sections.append("")

    if inventory:
        sections.append(f"=== INVENTARIO REAL DE RESIDUOS ({len(inventory)} residuos) ===")
        for item in inventory:
            pelig = "PELIGROSO" if item.get("peligroso") else "No peligroso"
            sections.append(
                f"- LER {item.get('codigo_ler')} | {item.get('descripcion', 'N/A')} | "
                f"{pelig} | {item.get('cantidad_anual_ton', 'N/A')} t/ano | "
                f"Gestor: {item.get('gestor_actual', 'N/A')}"
            )

    if not aai_docs and not aai_chunks:
        sections.append("NO HAY DOCUMENTOS DE AAI INDEXADOS PARA ESTE PROYECTO.")
        sections.append("Indica que no se puede realizar el analisis de AAI sin documentos.")

    # Inyectar instrucciones HITL
    hitl = build_instructions_block(state) + build_agent_focus_block(state, "aai") + build_previous_findings_block(state, "aai")
    if hitl:
        sections.insert(0, hitl)

    return "\n".join(sections)


async def agent_aai(state: AnalysisState) -> dict:
    """Nodo del agente AAI."""
    errors = list(state.get("errors", []))
    context = _build_aai_context(state)

    try:
        result = await call_claude(
            api_key=state["anthropic_api_key"],
            system_prompt=SYSTEM_AAI,
            user_message=context,
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
                agente="aai",
                datos=f.get("datos", {}),
            ))

        logger.info(f"Agente AAI: {len(findings)} hallazgos")
        return {"aai_findings": findings, "errors": errors}

    except Exception as e:
        logger.error(f"Error en agente AAI: {e}")
        errors.append(f"Agente AAI: {e}")
        return {"aai_findings": [], "errors": errors}
