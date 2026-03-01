"""
AGENTE REGISTRO - Verificacion de plazos y cumplimiento
=========================================================
Analiza registros de produccion y cronologicos para detectar
incumplimientos de plazos legales.
"""

import logging
from .state import AnalysisState, Finding
from .prompts import SYSTEM_REGISTRO, build_instructions_block, build_agent_focus_block, build_previous_findings_block
from .llm import call_claude, routing_kwargs

logger = logging.getLogger(__name__)


def _build_registro_context(state: AnalysisState) -> str:
    """Construye el contexto para el agente de registro."""
    pd = state.get("project_data", {})
    project = pd.get("project", {})
    documents = pd.get("documents", [])
    chunks = pd.get("chunks", [])
    inventory = pd.get("inventory", [])
    alerts = pd.get("alerts", [])

    # Chunks de registros y DARI
    registro_docs = [
        d for d in documents
        if d.get("tipo") in ("registro_produccion", "declaracion_anual_residuos")
    ]
    registro_doc_ids = {d["id"] for d in registro_docs}
    registro_chunks = [c for c in chunks if c.get("document_id") in registro_doc_ids]

    sections = []
    sections.append(f"PROYECTO: {project.get('nombre', 'N/A')}")
    sections.append(f"CCAA: {project.get('comunidad_autonoma', 'N/A')}")
    sections.append(f"CNAE: {project.get('cnae', 'N/A')}")
    sections.append("")

    if registro_docs:
        sections.append(f"=== DOCUMENTOS DE REGISTRO/DARI ({len(registro_docs)}) ===")
        for doc in registro_docs:
            sections.append(
                f"- {doc.get('titulo', 'Sin titulo')} | Tipo: {doc.get('tipo')} | "
                f"Fecha doc: {doc.get('fecha_documento', 'N/A')} | "
                f"Estado: {doc.get('estado')}"
            )
        sections.append("")

    if registro_chunks:
        sections.append(f"=== CONTENIDO REGISTROS ({len(registro_chunks)} fragmentos) ===")
        for chunk in registro_chunks[:25]:
            sections.append(f"[{chunk.get('chunk_type', 'texto')}] {chunk.get('contenido', '')[:1500]}")
            sections.append("---")
        sections.append("")

    if inventory:
        sections.append(f"=== INVENTARIO DE RESIDUOS ===")
        for item in inventory:
            pelig = "PELIGROSO" if item.get("peligroso") else "No peligroso"
            sections.append(
                f"- LER {item.get('codigo_ler')} | {pelig} | "
                f"{item.get('cantidad_anual_ton', 'N/A')} t/ano | "
                f"Frecuencia recogida: {item.get('frecuencia_recogida', 'N/A')}"
            )
        sections.append("")

    if alerts:
        existing_alerts = [a for a in alerts if a.get("tipo") in ("almacenamiento_excedido", "dari_no_presentada")]
        if existing_alerts:
            sections.append(f"=== ALERTAS EXISTENTES RELACIONADAS ===")
            for a in existing_alerts:
                sections.append(f"- [{a.get('severidad')}] {a.get('descripcion')} | Estado: {a.get('estado')}")

    if not registro_docs and not registro_chunks:
        sections.append("NO HAY DOCUMENTOS DE REGISTRO/DARI INDEXADOS.")
        sections.append("Analiza el inventario para detectar posibles problemas de plazos basandote en los datos disponibles.")

    # Inyectar instrucciones HITL
    hitl = build_instructions_block(state) + build_agent_focus_block(state, "registro") + build_previous_findings_block(state, "registro")
    if hitl:
        sections.insert(0, hitl)

    return "\n".join(sections)


async def agent_registro(state: AnalysisState) -> dict:
    """Nodo del agente de registro."""
    errors = list(state.get("errors", []))
    context = _build_registro_context(state)

    try:
        result = await call_claude(
            api_key=state["anthropic_api_key"],
            system_prompt=SYSTEM_REGISTRO,
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
                agente="registro",
                datos=f.get("datos", {}),
            ))

        logger.info(f"Agente Registro: {len(findings)} hallazgos")
        return {"registro_findings": findings, "errors": errors}

    except Exception as e:
        logger.error(f"Error en agente Registro: {e}")
        errors.append(f"Agente Registro: {e}")
        return {"registro_findings": [], "errors": errors}
