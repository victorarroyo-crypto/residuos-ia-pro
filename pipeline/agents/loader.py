"""
CARGADOR DE DATOS DEL PROYECTO
================================
Nodo inicial del grafo: carga todos los datos del proyecto
desde Supabase para que los agentes los consuman.
"""

import logging
from supabase import create_client, Client

from .state import AnalysisState, ProjectData

logger = logging.getLogger(__name__)


def _get_supabase(state: AnalysisState) -> Client:
    return create_client(state["supabase_url"], state["supabase_key"])


def load_project_data(state: AnalysisState) -> dict:
    """Carga todos los datos del proyecto desde Supabase."""
    sb = _get_supabase(state)
    project_id = state["project_id"]
    errors: list[str] = list(state.get("errors", []))

    try:
        project_res = sb.table("projects").select("*").eq("id", project_id).single().execute()
        project = project_res.data
    except Exception as e:
        errors.append(f"Error cargando proyecto: {e}")
        return {"errors": errors}

    if not project:
        errors.append(f"Proyecto {project_id} no encontrado")
        return {"errors": errors}

    # Cargar todas las tablas relacionadas en paralelo (sync)
    try:
        docs_res = sb.table("project_documents").select("*").eq("project_id", project_id).execute()
        chunks_res = sb.table("project_chunks").select("id, document_id, contenido, chunk_type, page_start, metadata").eq("project_id", project_id).execute()
        inventory_res = sb.table("waste_inventory").select("*").eq("project_id", project_id).execute()
        alerts_res = sb.table("compliance_alerts").select("*").eq("project_id", project_id).execute()
        savings_res = sb.table("savings_opportunities").select("*").eq("project_id", project_id).execute()
        contracts_res = sb.table("contracts").select("*").eq("project_id", project_id).execute()
        invoice_res = sb.table("invoice_lines").select("*").eq("project_id", project_id).execute()

        # Cargar gestores referenciados en contratos
        contract_manager_ids = [
            c["manager_id"]
            for c in (contracts_res.data or [])
            if c.get("manager_id")
        ]
        managers = []
        if contract_manager_ids:
            managers_res = sb.table("waste_managers").select("*").in_("id", contract_manager_ids).execute()
            managers = managers_res.data or []

    except Exception as e:
        errors.append(f"Error cargando datos del proyecto: {e}")
        return {"project_data": ProjectData(project=project), "errors": errors}

    project_data: ProjectData = {
        "project": project,
        "documents": docs_res.data or [],
        "chunks": chunks_res.data or [],
        "inventory": inventory_res.data or [],
        "alerts": alerts_res.data or [],
        "savings": savings_res.data or [],
        "contracts": contracts_res.data or [],
        "invoice_lines": invoice_res.data or [],
        "managers": managers,
    }

    logger.info(
        f"Proyecto {project['nombre']}: "
        f"{len(project_data['documents'])} docs, "
        f"{len(project_data['chunks'])} chunks, "
        f"{len(project_data['inventory'])} residuos, "
        f"{len(project_data['contracts'])} contratos, "
        f"{len(project_data['invoice_lines'])} lineas factura"
    )

    return {"project_data": project_data, "errors": errors}
