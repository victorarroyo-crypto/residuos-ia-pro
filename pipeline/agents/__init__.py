"""
AGENTES DE ANALISIS - ResidusIA Pro
====================================
Sistema multi-agente con LangGraph para analisis integral
de proyectos de gestion de residuos industriales.

Arquitectura del grafo:

  load_project_data  (carga datos de Supabase)
        |
        v
  +-----------+----------+-----------+-----------+
  |           |          |           |           |
  v           v          v           v           v
 AAI     Contratos   Facturas   Registro   Normativo
  |           |          |           |           |
  +-----------+----------+-----------+-----------+
        |
        v
   Optimizador  (cruza hallazgos, prioriza por EUR/ano)
        |
        v
    Redactor    (genera informe ejecutivo final)
"""

from .graph import build_analysis_graph, run_project_analysis
from .state import AnalysisState

__all__ = ["build_analysis_graph", "run_project_analysis", "AnalysisState"]
