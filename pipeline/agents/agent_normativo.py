"""
AGENTE NORMATIVO - Consulta RAG de base de conocimiento
=========================================================
Usa el RAG General (knowledge_documents/chunks) para buscar
normativa aplicable al sector y CCAA del proyecto.
"""

import logging
from .state import AnalysisState, Finding
from .prompts import SYSTEM_NORMATIVO
from .llm import call_claude

logger = logging.getLogger(__name__)


def _build_rag_queries(state: AnalysisState) -> list[str]:
    """Genera queries RAG basadas en el perfil del proyecto."""
    pd = state.get("project_data", {})
    project = pd.get("project", {})
    inventory = pd.get("inventory", [])

    sector = project.get("sector", "")
    ccaa = project.get("comunidad_autonoma", "")
    cnae = project.get("cnae", "")

    queries = []

    if sector:
        queries.append(f"normativa residuos industriales sector {sector}")
    if ccaa:
        queries.append(f"legislacion residuos {ccaa}")
    if cnae:
        queries.append(f"BREF mejores tecnicas disponibles CNAE {cnae}")

    # Queries por tipos de residuos peligrosos
    lers_peligrosos = [i.get("codigo_ler") for i in inventory if i.get("peligroso")]
    if lers_peligrosos:
        queries.append(f"obligaciones residuos peligrosos LER {' '.join(lers_peligrosos[:5])}")

    # Siempre buscar obligaciones generales
    queries.append("obligaciones productor residuos Ley 7/2022")

    return queries


def _search_knowledge_text(state: AnalysisState, queries: list[str]) -> str:
    """Busca en knowledge_chunks por texto (sin embeddings)."""
    from supabase import create_client

    sb = create_client(state["supabase_url"], state["supabase_key"])
    all_chunks = []
    seen_ids = set()

    for query in queries:
        terms = [t for t in query.lower().split() if len(t) > 3][:5]
        if not terms:
            continue

        or_filters = ",".join(f"contenido.ilike.%{t}%" for t in terms)
        try:
            result = sb.table("knowledge_chunks").select(
                "id, document_id, contenido, chunk_type"
            ).or_(or_filters).limit(5).execute()

            for chunk in (result.data or []):
                if chunk["id"] not in seen_ids:
                    seen_ids.add(chunk["id"])
                    all_chunks.append(chunk)
        except Exception as e:
            logger.warning(f"Error buscando knowledge para '{query}': {e}")

    if not all_chunks:
        return "No se encontro normativa relevante en la base de conocimiento."

    # Obtener titulos de documentos
    doc_ids = list({c["document_id"] for c in all_chunks})
    try:
        docs_res = sb.table("knowledge_documents").select("id, titulo, tipo").in_("id", doc_ids).execute()
        doc_map = {d["id"]: d for d in (docs_res.data or [])}
    except Exception:
        doc_map = {}

    sections = [f"=== BASE DE CONOCIMIENTO NORMATIVA ({len(all_chunks)} fragmentos) ==="]
    for chunk in all_chunks[:15]:  # Limitar contexto
        doc = doc_map.get(chunk["document_id"], {})
        sections.append(
            f"\n[{doc.get('tipo', 'N/A')} | {doc.get('titulo', 'Doc sin titulo')}]\n"
            f"{chunk['contenido'][:2000]}"
        )
        sections.append("---")

    return "\n".join(sections)


def _build_normativo_context(state: AnalysisState) -> str:
    """Construye el contexto completo para el agente normativo."""
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

    # Buscar normativa relevante via RAG
    queries = _build_rag_queries(state)
    rag_context = _search_knowledge_text(state, queries)
    sections.append(rag_context)

    return "\n".join(sections)


async def agent_normativo(state: AnalysisState) -> dict:
    """Nodo del agente normativo."""
    errors = list(state.get("errors", []))
    context = _build_normativo_context(state)

    try:
        result = await call_claude(
            api_key=state["anthropic_api_key"],
            system_prompt=SYSTEM_NORMATIVO,
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
                agente="normativo",
                datos=f.get("datos", {}),
            ))

        logger.info(f"Agente Normativo: {len(findings)} hallazgos")
        return {"normativo_findings": findings, "errors": errors}

    except Exception as e:
        logger.error(f"Error en agente Normativo: {e}")
        errors.append(f"Agente Normativo: {e}")
        return {"normativo_findings": [], "errors": errors}
