-- Migration 006: Añadir nuevos tipos de documento de proyecto
-- Nuevos tipos: analisis_residuos, informe_certificacion, solicitud_cotizacion,
--               ficha_seguridad, informe_tecnico, plan_gestion
--
-- INSTRUCCIONES: Ejecutar en Supabase SQL Editor.
-- Esto actualiza el CHECK constraint de project_documents.tipo para aceptar los nuevos tipos.

-- 1. Eliminar el constraint existente
ALTER TABLE project_documents DROP CONSTRAINT IF EXISTS valid_project_tipo;

-- 2. Crear el nuevo constraint con todos los tipos
ALTER TABLE project_documents ADD CONSTRAINT valid_project_tipo CHECK (tipo IN (
  'autorizacion_ambiental_integrada',
  'declaracion_anual_residuos',
  'contrato_gestor',
  'factura',
  'registro_produccion',
  'permiso_ambiental',
  'manual_interno',
  'desconocido',
  'costes_anuales',
  'inventario_ler',
  'comparativa_gestores',
  'facturas_agregadas',
  'presupuesto',
  'analisis_residuos',
  'informe_certificacion',
  'solicitud_cotizacion',
  'ficha_seguridad',
  'informe_tecnico',
  'plan_gestion'
));

-- 3. Notificar a PostgREST para que recargue el schema cache
NOTIFY pgrst, 'reload schema';
