-- Core inventory and production tables for ImportERP

CREATE EXTENSION IF NOT EXISTS pgcrypto;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'inventory_ledger'
  ) THEN
    CREATE TABLE inventory_ledger (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      product_id uuid NOT NULL,
      quantity numeric(12,3) NOT NULL DEFAULT 0,
      unit_cost_etb numeric(12,2),
      movement_type text NOT NULL DEFAULT 'UNKNOWN',
      movement_date date NOT NULL DEFAULT CURRENT_DATE,
      warehouse_id uuid NOT NULL DEFAULT '00000000-0000-0000-0000-000000000001',
      notes text,
      reference_type text,
      reference_id text,
      created_at timestamptz NOT NULL DEFAULT now()
    );
  ELSE
    ALTER TABLE inventory_ledger ADD COLUMN IF NOT EXISTS product_id uuid;
    ALTER TABLE inventory_ledger ADD COLUMN IF NOT EXISTS quantity numeric(12,3) DEFAULT 0;
    ALTER TABLE inventory_ledger ADD COLUMN IF NOT EXISTS unit_cost_etb numeric(12,2);
    ALTER TABLE inventory_ledger ADD COLUMN IF NOT EXISTS movement_type text DEFAULT 'UNKNOWN';
    ALTER TABLE inventory_ledger ADD COLUMN IF NOT EXISTS movement_date date DEFAULT CURRENT_DATE;
    ALTER TABLE inventory_ledger ADD COLUMN IF NOT EXISTS notes text;
    ALTER TABLE inventory_ledger ADD COLUMN IF NOT EXISTS reference_type text;
    ALTER TABLE inventory_ledger ADD COLUMN IF NOT EXISTS reference_id text;
    ALTER TABLE inventory_ledger ADD COLUMN IF NOT EXISTS warehouse_id uuid DEFAULT '00000000-0000-0000-0000-000000000001';
    ALTER TABLE inventory_ledger ADD COLUMN IF NOT EXISTS created_at timestamptz DEFAULT now();
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'warehouses'
  ) THEN
    CREATE TABLE warehouses (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      name text NOT NULL UNIQUE,
      code text NOT NULL UNIQUE,
      address text,
      city text,
      is_active boolean NOT NULL DEFAULT true,
      created_at timestamptz NOT NULL DEFAULT now()
    );
  ELSE
    ALTER TABLE warehouses ADD COLUMN IF NOT EXISTS name text;
    ALTER TABLE warehouses ADD COLUMN IF NOT EXISTS code text;
    ALTER TABLE warehouses ADD COLUMN IF NOT EXISTS address text;
    ALTER TABLE warehouses ADD COLUMN IF NOT EXISTS city text;
    ALTER TABLE warehouses ADD COLUMN IF NOT EXISTS is_active boolean DEFAULT true;
    ALTER TABLE warehouses ADD COLUMN IF NOT EXISTS created_at timestamptz DEFAULT now();
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'warehouses_code_key'
      AND conrelid = 'public.warehouses'::regclass
  ) THEN
    ALTER TABLE warehouses ADD CONSTRAINT warehouses_code_key UNIQUE (code);
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'warehouses_name_key'
      AND conrelid = 'public.warehouses'::regclass
  ) THEN
    ALTER TABLE warehouses ADD CONSTRAINT warehouses_name_key UNIQUE (name);
  END IF;
END $$;

INSERT INTO warehouses (id, name, code, city, created_at)
VALUES ('00000000-0000-0000-0000-000000000001', 'Main Warehouse', 'MAIN', 'Addis Ababa', now())
ON CONFLICT (id) DO NOTHING;

CREATE INDEX IF NOT EXISTS idx_inventory_ledger_product_date
  ON inventory_ledger(product_id, movement_date DESC);

CREATE INDEX IF NOT EXISTS idx_inventory_ledger_movement_type
  ON inventory_ledger(movement_type, movement_date DESC);

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'shipments'
  ) THEN
    ALTER TABLE shipments ADD COLUMN IF NOT EXISTS warehouse_id uuid
      DEFAULT '00000000-0000-0000-0000-000000000001';
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'bom_headers'
  ) THEN
    CREATE TABLE bom_headers (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      product_id uuid NOT NULL,
      name text NOT NULL,
      description text,
      is_active boolean NOT NULL DEFAULT true,
      created_at timestamptz NOT NULL DEFAULT now()
    );
  ELSE
    ALTER TABLE bom_headers ADD COLUMN IF NOT EXISTS product_id uuid;
    ALTER TABLE bom_headers ADD COLUMN IF NOT EXISTS name text;
    ALTER TABLE bom_headers ADD COLUMN IF NOT EXISTS description text;
    ALTER TABLE bom_headers ADD COLUMN IF NOT EXISTS is_active boolean DEFAULT true;
    ALTER TABLE bom_headers ADD COLUMN IF NOT EXISTS created_at timestamptz DEFAULT now();
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_bom_headers_product
  ON bom_headers(product_id);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'bom_lines'
  ) THEN
    CREATE TABLE bom_lines (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      bom_header_id uuid NOT NULL REFERENCES bom_headers(id) ON DELETE CASCADE,
      component_product_id uuid NOT NULL,
      quantity_per_unit numeric(12,3) NOT NULL DEFAULT 0,
      notes text,
      created_at timestamptz NOT NULL DEFAULT now()
    );
  ELSE
    ALTER TABLE bom_lines ADD COLUMN IF NOT EXISTS bom_header_id uuid;
    ALTER TABLE bom_lines ADD COLUMN IF NOT EXISTS component_product_id uuid;
    ALTER TABLE bom_lines ADD COLUMN IF NOT EXISTS quantity_per_unit numeric(12,3) DEFAULT 0;
    ALTER TABLE bom_lines ADD COLUMN IF NOT EXISTS notes text;
    ALTER TABLE bom_lines ADD COLUMN IF NOT EXISTS created_at timestamptz DEFAULT now();
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_bom_lines_bom
  ON bom_lines(bom_header_id);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'production_orders'
  ) THEN
    CREATE TABLE production_orders (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      order_number text NOT NULL UNIQUE,
      product_id uuid,
      bom_header_id uuid REFERENCES bom_headers(id),
      target_quantity numeric(12,3) NOT NULL DEFAULT 0,
      completed_quantity numeric(12,3) NOT NULL DEFAULT 0,
      status text NOT NULL DEFAULT 'DRAFT'
        CHECK (status IN ('DRAFT', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED')),
      planned_start_date date,
      labor_cost_etb numeric(12,2) NOT NULL DEFAULT 0,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    );
  ELSE
    ALTER TABLE production_orders ADD COLUMN IF NOT EXISTS order_number text;
    ALTER TABLE production_orders ADD COLUMN IF NOT EXISTS product_id uuid;
    ALTER TABLE production_orders ADD COLUMN IF NOT EXISTS bom_header_id uuid;
    ALTER TABLE production_orders ADD COLUMN IF NOT EXISTS target_quantity numeric(12,3) DEFAULT 0;
    ALTER TABLE production_orders ADD COLUMN IF NOT EXISTS completed_quantity numeric(12,3) DEFAULT 0;
    ALTER TABLE production_orders ADD COLUMN IF NOT EXISTS status text DEFAULT 'DRAFT';
    ALTER TABLE production_orders ADD COLUMN IF NOT EXISTS planned_start_date date;
    ALTER TABLE production_orders ADD COLUMN IF NOT EXISTS labor_cost_etb numeric(12,2) DEFAULT 0;
    ALTER TABLE production_orders ADD COLUMN IF NOT EXISTS created_at timestamptz DEFAULT now();
    ALTER TABLE production_orders ADD COLUMN IF NOT EXISTS updated_at timestamptz DEFAULT now();
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_production_orders_status
  ON production_orders(status, created_at DESC);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'production_daily_logs'
  ) THEN
    CREATE TABLE production_daily_logs (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      production_order_id uuid NOT NULL REFERENCES production_orders(id) ON DELETE CASCADE,
      log_date date NOT NULL,
      quantity_produced numeric(12,3) NOT NULL DEFAULT 0,
      notes text,
      created_at timestamptz NOT NULL DEFAULT now()
    );
  ELSE
    ALTER TABLE production_daily_logs ADD COLUMN IF NOT EXISTS production_order_id uuid;
    ALTER TABLE production_daily_logs ADD COLUMN IF NOT EXISTS log_date date;
    ALTER TABLE production_daily_logs ADD COLUMN IF NOT EXISTS quantity_produced numeric(12,3) DEFAULT 0;
    ALTER TABLE production_daily_logs ADD COLUMN IF NOT EXISTS notes text;
    ALTER TABLE production_daily_logs ADD COLUMN IF NOT EXISTS created_at timestamptz DEFAULT now();
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_production_daily_logs_date
  ON production_daily_logs(log_date DESC, production_order_id);

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'shipment_expenses'
  ) THEN
    ALTER TABLE shipment_expenses ADD COLUMN IF NOT EXISTS is_paid boolean DEFAULT false;
    ALTER TABLE shipment_expenses ADD COLUMN IF NOT EXISTS paid_at timestamptz;
  END IF;
END $$;

ALTER TABLE inventory_ledger ENABLE ROW LEVEL SECURITY;
ALTER TABLE bom_headers ENABLE ROW LEVEL SECURITY;
ALTER TABLE bom_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE production_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE production_daily_logs ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'inventory_ledger'
      AND policyname = 'Allow all inventory_ledger'
  ) THEN
    CREATE POLICY "Allow all inventory_ledger" ON inventory_ledger
      FOR ALL USING (true) WITH CHECK (true);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'bom_headers'
      AND policyname = 'Allow all bom_headers'
  ) THEN
    CREATE POLICY "Allow all bom_headers" ON bom_headers
      FOR ALL USING (true) WITH CHECK (true);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'bom_lines'
      AND policyname = 'Allow all bom_lines'
  ) THEN
    CREATE POLICY "Allow all bom_lines" ON bom_lines
      FOR ALL USING (true) WITH CHECK (true);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'production_orders'
      AND policyname = 'Allow all production_orders'
  ) THEN
    CREATE POLICY "Allow all production_orders" ON production_orders
      FOR ALL USING (true) WITH CHECK (true);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'production_daily_logs'
      AND policyname = 'Allow all production_daily_logs'
  ) THEN
    CREATE POLICY "Allow all production_daily_logs" ON production_daily_logs
      FOR ALL USING (true) WITH CHECK (true);
  END IF;
END $$;
