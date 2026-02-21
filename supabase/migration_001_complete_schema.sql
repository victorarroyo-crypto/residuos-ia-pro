-- ================================================================
-- MIGRACIÓN 001 - Completar schema para funcionalidad completa
-- ================================================================
-- Ejecutar en Supabase SQL Editor si ya tienes la base de datos
-- creada con el setup.sql original (sin las columnas/tablas nuevas).
-- Es idempotente: se puede ejecutar múltiples veces sin error.
-- ================================================================

-- ── 1. Columnas nuevas en clients ─────────────────────────────
ALTER TABLE clients ADD COLUMN IF NOT EXISTS cnae TEXT;
ALTER TABLE clients ADD COLUMN IF NOT EXISTS municipio TEXT;
ALTER TABLE clients ADD COLUMN IF NOT EXISTS tipo_relacion TEXT;
ALTER TABLE clients ADD COLUMN IF NOT EXISTS metadata JSONB DEFAULT '{}';

-- Constraint para tipo_relacion (solo si no existe)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'clients_tipo_relacion_check'
  ) THEN
    ALTER TABLE clients ADD CONSTRAINT clients_tipo_relacion_check
      CHECK (tipo_relacion IN ('retainer','auditoria','diagnostico'));
  END IF;
END$$;

-- ── 2. Columnas nuevas en waste_inventory ─────────────────────
ALTER TABLE waste_inventory ADD COLUMN IF NOT EXISTS peligroso BOOLEAN DEFAULT false;
ALTER TABLE waste_inventory ADD COLUMN IF NOT EXISTS gestor_actual TEXT;
ALTER TABLE waste_inventory ADD COLUMN IF NOT EXISTS frecuencia_recogida TEXT;

-- ── 3. Tabla savings_opportunities ────────────────────────────
CREATE TABLE IF NOT EXISTS savings_opportunities (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id               UUID REFERENCES clients(id) ON DELETE CASCADE,
  waste_id                UUID REFERENCES waste_inventory(id),
  tipo                    TEXT NOT NULL,
  descripcion             TEXT NOT NULL,
  ahorro_estimado_eur_año DECIMAL(10,2),
  inversion_necesaria     DECIMAL(10,2),
  payback_meses           INT,
  norma_aplicable         TEXT,
  estado                  TEXT DEFAULT 'detectada'
    CHECK (estado IN ('detectada','propuesta','aceptada','implementada','descartada')),
  ia_generada             BOOLEAN DEFAULT false,
  created_at              TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_savings_client ON savings_opportunities(client_id);
CREATE INDEX IF NOT EXISTS idx_savings_estado ON savings_opportunities(estado);

-- ── 4. Tabla waste_managers ───────────────────────────────────
CREATE TABLE IF NOT EXISTS waste_managers (
  id                        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nombre                    TEXT NOT NULL,
  nif                       TEXT,
  numero_autorizacion       TEXT,
  ccaa_autorizacion         TEXT[],
  codigos_ler_autorizados   TEXT[],
  operaciones_autorizadas   TEXT[],
  precio_referencia_eur_ton DECIMAL(10,2),
  valoracion                DECIMAL(3,1),
  activo                    BOOLEAN DEFAULT true,
  created_at                TIMESTAMPTZ DEFAULT now()
);

-- ── 5. Tabla contracts ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS contracts (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id           UUID REFERENCES clients(id) ON DELETE CASCADE,
  manager_id          UUID REFERENCES waste_managers(id),
  fecha_inicio        DATE,
  fecha_vencimiento   DATE,
  codigos_ler         TEXT[],
  precio_eur_ton      DECIMAL(10,2),
  condiciones         JSONB DEFAULT '{}',
  storage_path        TEXT,
  alertar_dias_antes  INT DEFAULT 30,
  created_at          TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_contracts_client ON contracts(client_id);
CREATE INDEX IF NOT EXISTS idx_contracts_manager ON contracts(manager_id);
CREATE INDEX IF NOT EXISTS idx_contracts_vencimiento ON contracts(fecha_vencimiento)
  WHERE fecha_vencimiento IS NOT NULL;

-- ── 6. RLS para tablas nuevas ─────────────────────────────────
ALTER TABLE savings_opportunities ENABLE ROW LEVEL SECURITY;
ALTER TABLE contracts ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  -- savings_opportunities
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'user_own_savings') THEN
    CREATE POLICY "user_own_savings" ON savings_opportunities
      FOR ALL USING (
        client_id IN (SELECT id FROM clients WHERE consultant_id = auth.uid())
      );
  END IF;

  -- waste_managers (lectura para todos los autenticados)
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'authenticated_read_managers') THEN
    CREATE POLICY "authenticated_read_managers" ON waste_managers
      FOR SELECT USING (auth.role() = 'authenticated');
  END IF;

  -- contracts
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'user_own_contracts') THEN
    CREATE POLICY "user_own_contracts" ON contracts
      FOR ALL USING (
        client_id IN (SELECT id FROM clients WHERE consultant_id = auth.uid())
      );
  END IF;
END$$;
