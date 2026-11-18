-- =============================================================
-- ESTIMATES + LINE ITEMS
-- Run after schema.sql in the Supabase SQL Editor
-- =============================================================

-- =============================================================
-- 1. ESTIMATES
-- =============================================================
CREATE TABLE IF NOT EXISTS estimates (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id       UUID        NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  project_id       UUID        REFERENCES projects(id) ON DELETE SET NULL,
  title            TEXT        NOT NULL,
  notes            TEXT,
  status           TEXT        NOT NULL DEFAULT 'draft'
                               CHECK (status IN ('draft','sent','accepted','rejected')),
  -- Idempotency: client supplies a key on create; duplicates return the existing row
  idempotency_key  TEXT        UNIQUE,
  created_by       UUID        NOT NULL REFERENCES user_profiles(id) ON DELETE RESTRICT,
  sent_at          TIMESTAMPTZ,
  accepted_at      TIMESTAMPTZ,
  rejected_at      TIMESTAMPTZ,
  -- Soft delete — no hard deletes per spec
  deleted_at       TIMESTAMPTZ,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TRIGGER trg_estimates_updated_at
  BEFORE UPDATE ON estimates
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE INDEX IF NOT EXISTS idx_estimates_account_id  ON estimates(account_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_estimates_project_id  ON estimates(project_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_estimates_status      ON estimates(account_id, status) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_estimates_idempotency ON estimates(idempotency_key) WHERE idempotency_key IS NOT NULL;

ALTER TABLE estimates ENABLE ROW LEVEL SECURITY;
CREATE POLICY "estimates_service_role_all" ON estimates USING (TRUE) WITH CHECK (TRUE);

-- =============================================================
-- 2. ESTIMATE LINE ITEMS
-- Amounts stored in minor units (cents) as BIGINT — never float
-- =============================================================
CREATE TABLE IF NOT EXISTS estimate_line_items (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  estimate_id      UUID        NOT NULL REFERENCES estimates(id) ON DELETE CASCADE,
  description      TEXT        NOT NULL,
  quantity         NUMERIC(10,2) NOT NULL DEFAULT 1 CHECK (quantity > 0),
  unit_price_cents BIGINT      NOT NULL CHECK (unit_price_cents >= 0),
  sort_order       INTEGER     NOT NULL DEFAULT 0,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TRIGGER trg_estimate_line_items_updated_at
  BEFORE UPDATE ON estimate_line_items
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE INDEX IF NOT EXISTS idx_estimate_line_items_estimate ON estimate_line_items(estimate_id);

ALTER TABLE estimate_line_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY "estimate_line_items_service_role_all" ON estimate_line_items USING (TRUE) WITH CHECK (TRUE);

-- =============================================================
-- 3. RBAC — extend role permissions for financial data
-- Account Managers and above get manage_estimates
-- Project Managers and above get view_estimates
-- =============================================================
UPDATE roles SET permissions = permissions || '{"manage_estimates": true, "view_estimates": true}'
  WHERE name IN ('Superadmin', 'Executive Director', 'Account Manager');

UPDATE roles SET permissions = permissions || '{"view_estimates": true}'
  WHERE name IN ('Project Manager', 'Admin');
