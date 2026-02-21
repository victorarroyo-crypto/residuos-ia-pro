# Plan: ResidusIA Pro - App Completa y Utilizable

## Estado actual
- Pipeline Python: 100% completo (9 módulos)
- Schema Supabase: 100% completo (RLS, funciones vectoriales, realtime)
- Frontend: UI diseñada con datos MOCK, sin conexión real
- Auth: inexistente
- API Routes: inexistentes

---

## FASE 1: Autenticación (Login/Registro)
> Sin esto no hay app. Es lo primero.

1. **Página de Login** (`/login`) - email + password con Supabase Auth
2. **Página de Registro** (`/register`) - para nuevos consultores
3. **Middleware de protección** (`middleware.ts`) - redirigir a /login si no autenticado
4. **Layout con sesión** - provider de auth en layout.tsx, logout en sidebar
5. **Actualizar sidebar** - mostrar nombre/email real del usuario autenticado

---

## FASE 2: Conectar Frontend a Supabase (reemplazar MOCK data)
> Cada página deja de usar mock-data.ts y consulta Supabase directamente.

6. **Dashboard** - queries reales: contar clientes, docs, alertas, ahorros
7. **Clientes** - listar desde Supabase con filtros (búsqueda, tipo, activo)
8. **CRUD Clientes** - crear, editar y desactivar clientes (modal o página)
9. **Ficha de cliente** (`/client/[id]`) - cargar inventario, docs, alertas, ahorros reales
10. **Documentos** - listar docs reales de todos los clientes
11. **Alertas** - cargar compliance_alerts reales, permitir marcar como resueltas
12. **Ahorros** - cargar savings_opportunities reales
13. **Settings** - guardar perfil del consultor, preferencias en Supabase
14. **Eliminar mock-data.ts** cuando todo esté conectado

---

## FASE 3: Upload real + API de ingesta
> El corazón de la app: subir documentos y procesarlos con el pipeline.

15. **API Route `/api/ingest`** - endpoint Next.js que recibe archivos
16. **Upload real a Supabase Storage** - enviar archivo al bucket `documentos`
17. **Conectar pipeline** - el API route invoca el pipeline Python (vía HTTP a servicio externo o Supabase Edge Function)
18. **Progreso real-time** - la página upload ya escucha `pipeline_progress`, conectar con datos reales
19. **Visualizar resultado** - después del procesamiento, mostrar chunks/metadata extraídos

---

## FASE 4: Funcionalidades de negocio
> Lo que hace la app realmente útil para el consultor.

20. **Búsqueda RAG** - interfaz de chat/búsqueda que consulta el sistema RAG de dos niveles
21. **Gestión de proyectos** - crear/editar proyectos por cliente
22. **Gestión de inventario** - editar residuos, precios, cantidades manualmente
23. **Generación de alertas automáticas** - trigger cuando vence AAI, exceso almacenamiento, etc.
24. **Cálculo de ahorros** - comparar precios entre gestores, detectar oportunidades

---

## FASE 5: Polish y producción
> Últimos detalles para que sea profesional.

25. **Loading states** - skeletons/spinners en cada página mientras cargan datos
26. **Error handling** - toasts de error, estados vacíos ("No hay clientes aún")
27. **Responsive** - verificar móvil/tablet
28. **SEO y meta tags** - títulos por página
29. **Deploy pipeline Python** - Railway o Fly.io como servicio HTTP
30. **Dominio personalizado** - configurar en Vercel

---

## Orden de implementación recomendado
Fase 1 → Fase 2 → Fase 3 → Fase 4 → Fase 5

Cada fase es funcional por sí sola: al terminar Fase 2 ya tienes una app que muestra datos reales. Al terminar Fase 3 puedes subir documentos. Fase 4 la hace realmente inteligente.
