"""
AGENTE COORDINADOR - Planificacion inteligente del analisis
=============================================================
Analiza los datos disponibles del proyecto y propone un plan
de analisis: que agentes activar, con que foco, y que carencias
de datos existen.
"""

import logging
from .state import AnalysisState, AnalysisPlan, AgentPlan
from .llm import call_claude, routing_kwargs

logger = logging.getLogger(__name__)

SYSTEM_COORDINADOR = """Eres un coordinador de analisis de residuos industriales.

Se te proporcionan los datos cargados de un proyecto (documentos, inventario, contratos, facturas).
Tu tarea es proponer un plan de analisis inteligente:

1. Para cada agente (aai, contratos, facturas, registro, normativo), determina:
   - Si debe activarse (hay datos suficientes?)
   - Un foco especifico basado en los datos reales del proyecto
   - Razon de activacion/desactivacion
   - Resumen de datos disponibles

2. Identifica carencias de datos (que falta para un analisis completo)

3. Resume los datos del proyecto en numeros clave

Responde SIEMPRE en formato JSON con esta estructura:
{
  "agents": [
    {
      "id": "aai",
      "enabled": true,
      "reason": "2 documentos AAI encontrados con 45 chunks",
      "focus": "Cruzar LERs autorizados con los 12 residuos del inventario, priorizando los 3 peligrosos",
      "data_available": {"docs": 2, "chunks": 45, "related_inventory": 12}
    },
    {
      "id": "contratos",
      "enabled": true,
      "reason": "2 contratos activos, 1 vence en 45 dias",
      "focus": "Verificar precios vs mercado y alertar vencimiento proximo",
      "data_available": {"contracts": 2, "managers": 2}
    },
    {
      "id": "facturas",
      "enabled": false,
      "reason": "No hay facturas ni lineas de factura indexadas",
      "focus": "",
      "data_available": {"invoice_lines": 0, "invoice_docs": 0}
    },
    {
      "id": "registro",
      "enabled": false,
      "reason": "No hay documentos de registro/DARI",
      "focus": "",
      "data_available": {"registro_docs": 0}
    },
    {
      "id": "normativo",
      "enabled": true,
      "reason": "Proyecto con sector y CCAA definidos",
      "focus": "Normativa sector metalurgico en Catalunya, foco en residuos peligrosos",
      "data_available": {"sector": "metalurgia", "ccaa": "Catalunya"}
    }
  ],
  "data_summary": {
    "total_documents": 5,
    "total_chunks": 120,
    "inventory_items": 12,
    "hazardous_count": 3,
    "contracts": 2,
    "invoice_lines": 0,
    "total_waste_cost_eur": 45000
  },
  "data_gaps": [
    "No hay facturas indexadas - no se puede verificar coherencia precio facturado vs contratado",
    "No hay documentos de registro/DARI - no se puede verificar plazos de almacenamiento"
  ]
}"""


def _build_coordinador_context(state: AnalysisState) -> str:
    """Construye el resumen de datos para el coordinador."""
    pd = state.get("project_data", {})
    project = pd.get("project", {})
    documents = pd.get("documents", [])
    chunks = pd.get("chunks", [])
    inventory = pd.get("inventory", [])
    contracts = pd.get("contracts", [])
    managers = pd.get("managers", [])
    invoice_lines = pd.get("invoice_lines", [])
    alerts = pd.get("alerts", [])

    sections = []
    sections.append(f"PROYECTO: {project.get('nombre', 'N/A')}")
    sections.append(f"SECTOR: {project.get('sector', 'N/A')}")
    sections.append(f"CNAE: {project.get('cnae', 'N/A')}")
    sections.append(f"CCAA: {project.get('comunidad_autonoma', 'N/A')}")
    sections.append(f"MUNICIPIO: {project.get('municipio', 'N/A')}")
    sections.append("")

    # Documentos por tipo
    doc_types = {}
    for doc in documents:
        t = doc.get("tipo", "desconocido")
        doc_types[t] = doc_types.get(t, 0) + 1

    sections.append(f"=== DOCUMENTOS ({len(documents)} total, {len(chunks)} chunks) ===")
    for dtype, count in sorted(doc_types.items()):
        sections.append(f"  - {dtype}: {count}")
    sections.append("")

    # Inventario
    if inventory:
        hazardous = [i for i in inventory if i.get("peligroso")]
        total_cost = sum(
            (i.get("cantidad_anual_ton") or 0) * (i.get("precio_actual_eur_ton") or 0)
            for i in inventory
        )
        sections.append(f"=== INVENTARIO ({len(inventory)} residuos, {len(hazardous)} peligrosos) ===")
        sections.append(f"  Coste anual total: {total_cost:,.0f} EUR")
        for item in inventory:
            pelig = " [PELIGROSO]" if item.get("peligroso") else ""
            sections.append(
                f"  - LER {item.get('codigo_ler')} | {item.get('descripcion', 'N/A')}{pelig} | "
                f"{item.get('cantidad_anual_ton', 0)} t/a | {item.get('precio_actual_eur_ton', 0)} EUR/t"
            )
        sections.append("")

    # Contratos
    sections.append(f"=== CONTRATOS ({len(contracts)}) ===")
    for c in contracts:
        mgr = next((m for m in managers if m.get("id") == c.get("manager_id")), {})
        sections.append(
            f"  - Gestor: {mgr.get('nombre', 'N/A')} | LERs: {c.get('codigos_ler', [])} | "
            f"Precio: {c.get('precio_eur_ton', 'N/A')} EUR/t | "
            f"Vencimiento: {c.get('fecha_vencimiento', 'N/A')}"
        )
    sections.append("")

    # Facturas
    sections.append(f"=== FACTURAS ({len(invoice_lines)} lineas) ===")
    factura_docs = [d for d in documents if d.get("tipo") == "factura"]
    sections.append(f"  Documentos de factura: {len(factura_docs)}")
    sections.append("")

    # Alertas existentes
    pending_alerts = [a for a in alerts if a.get("estado") == "pendiente"]
    if pending_alerts:
        sections.append(f"=== ALERTAS PENDIENTES ({len(pending_alerts)}) ===")
        for a in pending_alerts[:5]:
            sections.append(f"  - [{a.get('severidad')}] {a.get('descripcion')}")
        sections.append("")

    return "\n".join(sections)


async def agent_coordinador(state: AnalysisState) -> dict:
    """Genera un plan de analisis inteligente basado en los datos disponibles."""
    errors = list(state.get("errors", []))
    context = _build_coordinador_context(state)

    try:
        result = await call_claude(
            api_key=state["anthropic_api_key"],
            system_prompt=SYSTEM_COORDINADOR,
            user_message=context,
            **routing_kwargs(state),
        )

        agents = []
        for a in result.get("agents", []):
            agents.append(AgentPlan(
                id=a.get("id", ""),
                enabled=a.get("enabled", False),
                reason=a.get("reason", ""),
                focus=a.get("focus", ""),
                data_available=a.get("data_available", {}),
            ))

        plan = AnalysisPlan(
            agents=agents,
            data_summary=result.get("data_summary", {}),
            data_gaps=result.get("data_gaps", []),
        )

        logger.info(
            f"Coordinador: {sum(1 for a in agents if a.get('enabled'))} agentes recomendados, "
            f"{len(plan.get('data_gaps', []))} carencias detectadas"
        )
        return {"analysis_plan": plan, "errors": errors}

    except Exception as e:
        logger.error(f"Error en coordinador: {e}")
        errors.append(f"Coordinador: {e}")
        return {"analysis_plan": {}, "errors": errors}
