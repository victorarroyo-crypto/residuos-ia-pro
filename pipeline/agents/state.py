"""
ESTADO DEL GRAFO DE ANALISIS
==============================
TypedDict que fluye por todos los nodos del grafo LangGraph.
Cada agente lee lo que necesita y escribe sus hallazgos.
"""

from __future__ import annotations

from typing import TypedDict


class ProjectData(TypedDict, total=False):
    """Datos crudos del proyecto cargados de Supabase."""
    project: dict
    documents: list[dict]
    chunks: list[dict]
    inventory: list[dict]
    alerts: list[dict]
    savings: list[dict]
    contracts: list[dict]
    invoice_lines: list[dict]
    managers: list[dict]


class Finding(TypedDict, total=False):
    """Un hallazgo individual de un agente."""
    tipo: str               # categoria del hallazgo
    descripcion: str        # descripcion legible
    severidad: str          # critica | alta | media | baja | info
    ahorro_eur_ano: float   # ahorro estimado si aplica
    inversion_eur: float    # inversion necesaria si aplica
    norma: str              # base legal si aplica
    agente: str             # que agente lo genero
    datos: dict             # datos de soporte


class AgentPlan(TypedDict, total=False):
    """Plan propuesto por el coordinador para un agente."""
    id: str                    # aai | contratos | facturas | registro | normativo
    enabled: bool              # si se recomienda ejecutar
    reason: str                # por que si/no
    focus: str                 # foco sugerido para el agente
    data_available: dict       # resumen de datos disponibles


class AnalysisPlan(TypedDict, total=False):
    """Plan completo generado por el coordinador."""
    agents: list[AgentPlan]
    data_summary: dict         # resumen de datos del proyecto
    data_gaps: list[str]       # carencias de datos detectadas


class AnalysisState(TypedDict, total=False):
    """Estado completo del grafo de analisis."""
    # Input
    project_id: str
    supabase_url: str
    supabase_key: str
    anthropic_api_key: str
    openai_api_key: str

    # HITL: instrucciones del consultor y foco por agente
    consultant_instructions: str       # instrucciones libres del consultor
    agent_focus: dict[str, str]        # {agent_id: "foco especifico"}
    round_number: int                  # 1 = primera vuelta, 2 = segunda
    previous_findings: list[Finding]   # hallazgos de ronda anterior (para 2a vuelta)

    # Datos del proyecto (cargados por load_project_data)
    project_data: ProjectData

    # Plan del coordinador
    analysis_plan: AnalysisPlan

    # Hallazgos por agente
    aai_findings: list[Finding]
    contratos_findings: list[Finding]
    facturas_findings: list[Finding]
    registro_findings: list[Finding]
    normativo_findings: list[Finding]

    # Optimizador: hallazgos priorizados
    opportunities: list[Finding]

    # Redactor: informe final
    report: str

    # Errores
    errors: list[str]
