# Plan de desarrollo — ResidusIA Pro
# Actualizado: 23 febrero 2026

## Estado actual

### Completado
- [x] Esquema Supabase migrado (knowledge_documents, project_documents, etc.)
- [x] Frontend Next.js desplegado en Vercel (dashboard, knowledge-base, projects)
- [x] Pipeline Python (PDF, Excel, texto)
- [x] Integración Google Drive (OAuth, browse, sync, ingest)
- [x] RLS configurado correctamente
- [x] Funciones RAG (search_knowledge, search_project, search_combined)
- [x] 33 documentos indexados en knowledge_documents
- [x] Auditoría completa de Supabase (CLAUDE.md)

### Problemas pendientes
- [ ] **Error PGRST205**: PostgREST no ve knowledge_documents en su schema cache. La tabla existe. Requiere reload del cache o restart del proyecto en Supabase Dashboard.
- [ ] **33 docs pero solo 9 chunks**: La mayoría de documentos no tienen chunks → no son buscables por RAG. Investigar por qué el pipeline no generó chunks.
- [ ] pipeline_progress sin RLS (riesgo bajo)
- [ ] gdrive_sync_log y consultant_gdrive sin FK a auth.users

---

## Fases

### FASE 1 — Estabilizar lo que hay (ACTUAL)

1. [ ] Resolver error PGRST205 (reload schema cache en Supabase)
2. [ ] Investigar y corregir los 24 documentos sin chunks
3. [ ] Verificar que el pipeline genera chunks correctamente al ingestar nuevos docs

### FASE 2 — UI funcional completa

4. [ ] Página de proyecto: ficha con inventario + documentos + alertas + ahorros
5. [ ] Subida de documentos por proyecto (drag & drop con barra de progreso Realtime)
6. [ ] Asistente RAG en la UI (chat que busca en ambos RAGs)

### FASE 3 — Motor de análisis IA (LangGraph)

7. [ ] AgenteAAI: analizar autorizaciones ambientales
8. [ ] AgenteContratos: precios, vencimientos, cláusulas vs benchmarks
9. [ ] AgenteFacturas: anomalías financieras
10. [ ] AgenteRegistro: incumplimientos de plazos
11. [ ] AgenteNormativo: obligaciones por sector + CCAA
12. [ ] AgenteOptimizador: oportunidades priorizadas por €/año
13. [ ] AgenteRedactor: informes ejecutivos

### FASE 4 — Completar la plataforma

14. [ ] Monitor de cumplimiento con calendario
15. [ ] Generador de informes PDF
16. [ ] Dashboard analytics del negocio del consultor
