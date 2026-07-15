-- Warehouse/assembly daily log: product images, production order due dates
-- (for late-order tracking), and damage reports linked back to the
-- originating shipment/PO for supplier claims.

-- ── products: image for the simple, image-based daily-log picker ───────
ALTER TABLE products ADD COLUMN IF NOT EXISTS image_url text;

-- ── production_orders: promised date, so "late" is a real, visible signal ─
ALTER TABLE production_orders ADD COLUMN IF NOT EXISTS due_date date;

-- ── damage_reports ───────────────────────────────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'damage_reports'
  ) THEN
    CREATE TABLE damage_reports (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      report_number text NOT NULL UNIQUE,
      product_id uuid NOT NULL,
      warehouse_id uuid NOT NULL REFERENCES warehouses(id),
      quantity numeric(12,3) NOT NULL CHECK (quantity > 0),
      reason text NOT NULL,
      photo_url text,
      shipment_id uuid REFERENCES shipments(id),
      purchase_order_id uuid REFERENCES purchase_orders(id),
      reported_by_employee_id uuid,
      report_date date NOT NULL DEFAULT CURRENT_DATE,
      notes text,
      created_at timestamptz NOT NULL DEFAULT now()
    );
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_damage_reports_date ON damage_reports(report_date DESC);
CREATE INDEX IF NOT EXISTS idx_damage_reports_shipment ON damage_reports(shipment_id);

ALTER TABLE damage_reports ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'damage_reports' AND policyname = 'Authenticated only'
  ) THEN
    CREATE POLICY "Authenticated only" ON damage_reports
      FOR ALL USING (auth.role() = 'authenticated') WITH CHECK (auth.role() = 'authenticated');
  END IF;
END $$;

-- ── storage: product-images bucket (new) ────────────────────────────────
INSERT INTO storage.buckets (id, name, public)
VALUES ('product-images', 'product-images', true) -- public read: plain product photos, not sensitive documents
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "product-images read" ON storage.objects;
CREATE POLICY "product-images read" ON storage.objects
  FOR SELECT USING (bucket_id = 'product-images');

DROP POLICY IF EXISTS "product-images write" ON storage.objects;
CREATE POLICY "product-images write" ON storage.objects
  FOR INSERT WITH CHECK (bucket_id = 'product-images' AND auth.role() = 'authenticated');

DROP POLICY IF EXISTS "product-images update" ON storage.objects;
CREATE POLICY "product-images update" ON storage.objects
  FOR UPDATE USING (bucket_id = 'product-images' AND auth.role() = 'authenticated');

DROP POLICY IF EXISTS "product-images delete" ON storage.objects;
CREATE POLICY "product-images delete" ON storage.objects
  FOR DELETE USING (bucket_id = 'product-images' AND auth.role() = 'authenticated');

-- ── storage: retroactively lock down shipment-documents ─────────────────
-- These were created with USING (true) in 20250630_features.sql, which (as
-- with the table-level policies fixed in 20260715_emergency_rls_lockdown.sql)
-- grants access to unauthenticated requests too, not just logged-in users.
-- shipment-documents holds real commercial paperwork, so unlike product
-- photos it should not be publicly readable.
DROP POLICY IF EXISTS "Allow storage upload" ON storage.objects;
DROP POLICY IF EXISTS "Allow storage read" ON storage.objects;
DROP POLICY IF EXISTS "Allow storage delete" ON storage.objects;

CREATE POLICY "shipment-documents read" ON storage.objects
  FOR SELECT USING (bucket_id = 'shipment-documents' AND auth.role() = 'authenticated');
CREATE POLICY "shipment-documents write" ON storage.objects
  FOR INSERT WITH CHECK (bucket_id = 'shipment-documents' AND auth.role() = 'authenticated');
CREATE POLICY "shipment-documents delete" ON storage.objects
  FOR DELETE USING (bucket_id = 'shipment-documents' AND auth.role() = 'authenticated');

UPDATE storage.buckets SET public = false WHERE id = 'shipment-documents';
