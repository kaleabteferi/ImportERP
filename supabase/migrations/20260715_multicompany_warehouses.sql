-- Multi-company + 5-warehouse foundation for ImportERP.
--
-- Context: the business operates under up to 4 separate licenses (the main
-- HBK Trading PLC plus individually-licensed companies) that share people
-- and warehouses but must keep separate books/receipts. It also runs 5
-- physical warehouses (Jemo, Merkato K, Merkato B, Addisu Gebeya, and a new
-- production site in Debre Berhan), each of which can have its own
-- production manager.
--
-- This migration is intentionally additive only: it creates new tables and
-- adds nullable columns to existing ones. It does NOT enable/alter RLS on
-- pre-existing tables (shipments, sales_orders, purchase_orders,
-- production_orders) because their current policies are not version
-- controlled anywhere and altering them blind risks locking out the live
-- app. Company-scoped RLS on those tables is a follow-up migration once the
-- live policies have been inspected.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ── companies ────────────────────────────────────────────────────────────
-- One row per license/entity (HBK Trading PLC, individually-licensed
-- companies, etc). Already referenced by the frontend (src/api/companyExpenses.ts)
-- against a live `companies` table — this is written defensively in case
-- that table needs columns this migration relies on.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'companies'
  ) THEN
    CREATE TABLE companies (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      name text NOT NULL UNIQUE,
      license_type text,              -- e.g. 'PLC', 'Personal', 'Sole Proprietorship'
      tin_number text,
      is_primary boolean NOT NULL DEFAULT false,
      is_active boolean NOT NULL DEFAULT true,
      created_at timestamptz NOT NULL DEFAULT now()
    );
  ELSE
    ALTER TABLE companies ADD COLUMN IF NOT EXISTS license_type text;
    ALTER TABLE companies ADD COLUMN IF NOT EXISTS tin_number text;
    ALTER TABLE companies ADD COLUMN IF NOT EXISTS is_primary boolean NOT NULL DEFAULT false;
    ALTER TABLE companies ADD COLUMN IF NOT EXISTS is_active boolean NOT NULL DEFAULT true;
    ALTER TABLE companies ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now();
  END IF;
END $$;

-- ── company_members ─────────────────────────────────────────────────────
-- Which profiles (login accounts) can see/act on which company's data.
-- A 'full_access' role profile (CEO/GM/Assistant Manager tier) is treated
-- as implicitly a member of every company in application code and RLS
-- helper functions below — no row needed here for them.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'company_members'
  ) THEN
    CREATE TABLE company_members (
      company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
      profile_id uuid NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (company_id, profile_id)
    );
  END IF;
END $$;

-- Helper used by future RLS policies: true if the current user has
-- full_access (sees everything) or is an explicit member of p_company_id.
CREATE OR REPLACE FUNCTION user_can_access_company(p_company_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    p_company_id IS NULL
    OR EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid() AND profiles.role = 'full_access'
    )
    OR EXISTS (
      SELECT 1 FROM company_members
      WHERE company_members.company_id = p_company_id
        AND company_members.profile_id = auth.uid()
    );
$$;

ALTER TABLE companies ENABLE ROW LEVEL SECURITY;
ALTER TABLE company_members ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'companies' AND policyname = 'Authenticated read companies'
  ) THEN
    CREATE POLICY "Authenticated read companies" ON companies
      FOR SELECT USING (auth.role() = 'authenticated');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'companies' AND policyname = 'Full access manage companies'
  ) THEN
    CREATE POLICY "Full access manage companies" ON companies
      FOR ALL USING (
        EXISTS (SELECT 1 FROM profiles WHERE profiles.id = auth.uid() AND profiles.role = 'full_access')
      )
      WITH CHECK (
        EXISTS (SELECT 1 FROM profiles WHERE profiles.id = auth.uid() AND profiles.role = 'full_access')
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'company_members' AND policyname = 'Authenticated read company_members'
  ) THEN
    CREATE POLICY "Authenticated read company_members" ON company_members
      FOR SELECT USING (auth.role() = 'authenticated');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'company_members' AND policyname = 'Full access manage company_members'
  ) THEN
    CREATE POLICY "Full access manage company_members" ON company_members
      FOR ALL USING (
        EXISTS (SELECT 1 FROM profiles WHERE profiles.id = auth.uid() AND profiles.role = 'full_access')
      )
      WITH CHECK (
        EXISTS (SELECT 1 FROM profiles WHERE profiles.id = auth.uid() AND profiles.role = 'full_access')
      );
  END IF;
END $$;

-- ── warehouses: production manager + factory flag ──────────────────────
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'warehouses'
  ) THEN
    ALTER TABLE warehouses ADD COLUMN IF NOT EXISTS production_manager_employee_id uuid;
    ALTER TABLE warehouses ADD COLUMN IF NOT EXISTS has_production boolean NOT NULL DEFAULT false;
  END IF;
END $$;

-- Seed the 5 known physical warehouses. Uses the same
-- INSERT ... ON CONFLICT (name) DO NOTHING pattern as the original
-- "Main Warehouse" seed row so re-running this migration is harmless and it
-- won't clobber a warehouse the user already renamed/edited.
INSERT INTO warehouses (name, code, city, has_production, is_active)
VALUES
  ('Jemo',           'JEMO',  'Addis Ababa', false, true),
  ('Merkato K',      'MRK-K', 'Addis Ababa', false, true),
  ('Merkato B',      'MRK-B', 'Addis Ababa', false, true),
  ('Addisu Gebeya',  'ADG',   'Addis Ababa', false, true),
  ('Debre Berhan',   'DB',    'Debre Berhan', true, true)
ON CONFLICT (name) DO NOTHING;

-- ── warehouse_transfers ──────────────────────────────────────────────────
-- Tracks warehouse-to-warehouse (or warehouse-to-market) movement, e.g. the
-- "DB -> Adisu Bekeya -> Merkato" report: driver, plate, qty, item, purpose.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'warehouse_transfers'
  ) THEN
    CREATE TABLE warehouse_transfers (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      transfer_number text NOT NULL UNIQUE,
      from_warehouse_id uuid NOT NULL REFERENCES warehouses(id),
      to_warehouse_id uuid REFERENCES warehouses(id), -- null when purpose = 'SALES' (goods leave the warehouse network)
      product_id uuid NOT NULL,
      quantity numeric(12,3) NOT NULL CHECK (quantity > 0),
      transfer_date date NOT NULL DEFAULT CURRENT_DATE,
      purpose text NOT NULL DEFAULT 'WAREHOUSE_TO_WAREHOUSE'
        CHECK (purpose IN ('WAREHOUSE_TO_WAREHOUSE', 'SALES', 'RETURN', 'OTHER')),
      driver_name text,
      truck_plate text,
      requested_by_employee_id uuid,
      status text NOT NULL DEFAULT 'IN_TRANSIT'
        CHECK (status IN ('IN_TRANSIT', 'RECEIVED', 'CANCELLED')),
      received_at timestamptz,
      notes text,
      created_at timestamptz NOT NULL DEFAULT now()
    );
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_warehouse_transfers_date
  ON warehouse_transfers(transfer_date DESC);
CREATE INDEX IF NOT EXISTS idx_warehouse_transfers_status
  ON warehouse_transfers(status, transfer_date DESC);

ALTER TABLE warehouse_transfers ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'warehouse_transfers' AND policyname = 'Authenticated all warehouse_transfers'
  ) THEN
    CREATE POLICY "Authenticated all warehouse_transfers" ON warehouse_transfers
      FOR ALL USING (auth.role() = 'authenticated')
      WITH CHECK (auth.role() = 'authenticated');
  END IF;
END $$;

-- ── company_id on existing process tables (nullable, additive only) ─────
-- Left nullable deliberately: existing rows stay valid (NULL = ungrouped /
-- legacy), and RLS enforcement is deferred to a follow-up migration.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='shipments') THEN
    ALTER TABLE shipments ADD COLUMN IF NOT EXISTS company_id uuid REFERENCES companies(id);
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='sales_orders') THEN
    ALTER TABLE sales_orders ADD COLUMN IF NOT EXISTS company_id uuid REFERENCES companies(id);
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='purchase_orders') THEN
    ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS company_id uuid REFERENCES companies(id);
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='production_orders') THEN
    ALTER TABLE production_orders ADD COLUMN IF NOT EXISTS company_id uuid REFERENCES companies(id);
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='company_expenses') THEN
    ALTER TABLE company_expenses ADD COLUMN IF NOT EXISTS company_id uuid REFERENCES companies(id);
  END IF;
END $$;
