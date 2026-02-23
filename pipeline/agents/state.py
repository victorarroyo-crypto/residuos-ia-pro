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


class AnalysisState(TypedDict, total=False):
    """Estado completo del grafo de analisis."""
    # Input
    project_id: str
    supabase_url: str
    supabase_key: str
    anthropic_api_key: str
    openai_api_key: str

    # Datos del proyecto (cargados por load_project_data)
    project_data: ProjectData

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
