-- Company-scoped RLS, layered on top of 20260715_emergency_rls_lockdown.sql
-- and the company_id columns / user_can_access_company() helper added in
-- 20260715_multicompany_warehouses.sql.
--
-- Safe to apply at any time: user_can_access_company() returns true when
-- company_id IS NULL, and every row on these tables has company_id = NULL
-- today (no company has been assigned to any record yet). So this migration
-- changes nothing in practice until you start (a) creating companies in
-- Settings -> Companies, (b) assigning company_members, and (c) setting
-- company_id on individual shipments/orders — at which point access to that
-- record narrows to full_access profiles and members of that company.

-- ── Top-level tables with a company_id column ───────────────────────────
DO $$
DECLARE
  t text;
  tables text[] := ARRAY['shipments', 'sales_orders', 'purchase_orders', 'production_orders', 'company_expenses'];
BEGIN
  FOREACH t IN ARRAY tables LOOP
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = t) THEN
      EXECUTE format('DROP POLICY IF EXISTS "Authenticated only" ON public.%I', t);
      IF NOT EXISTS (
        SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = t AND policyname = 'Company scoped access'
      ) THEN
        EXECUTE format(
          'CREATE POLICY "Company scoped access" ON public.%I FOR ALL USING (auth.role() = ''authenticated'' AND user_can_access_company(company_id)) WITH CHECK (auth.role() = ''authenticated'' AND user_can_access_company(company_id))',
          t
        );
      END IF;
    END IF;
  END LOOP;
END $$;

-- ── Child tables: scoped via their parent's company_id ──────────────────
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'shipment_items') THEN
    EXECUTE 'DROP POLICY IF EXISTS "Authenticated only" ON shipment_items';
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'shipment_items' AND policyname = 'Company scoped via shipment') THEN
      CREATE POLICY "Company scoped via shipment" ON shipment_items
        FOR ALL USING (
          auth.role() = 'authenticated'
          AND EXISTS (SELECT 1 FROM shipments s WHERE s.id = shipment_items.shipment_id AND user_can_access_company(s.company_id))
        )
        WITH CHECK (
          auth.role() = 'authenticated'
          AND EXISTS (SELECT 1 FROM shipments s WHERE s.id = shipment_items.shipment_id AND user_can_access_company(s.company_id))
        );
    END IF;
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'shipment_expenses') THEN
    EXECUTE 'DROP POLICY IF EXISTS "Authenticated only" ON shipment_expenses';
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'shipment_expenses' AND policyname = 'Company scoped via shipment') THEN
      CREATE POLICY "Company scoped via shipment" ON shipment_expenses
        FOR ALL USING (
          auth.role() = 'authenticated'
          AND EXISTS (SELECT 1 FROM shipments s WHERE s.id = shipment_expenses.shipment_id AND user_can_access_company(s.company_id))
        )
        WITH CHECK (
          auth.role() = 'authenticated'
          AND EXISTS (SELECT 1 FROM shipments s WHERE s.id = shipment_expenses.shipment_id AND user_can_access_company(s.company_id))
        );
    END IF;
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'sales_order_lines') THEN
    EXECUTE 'DROP POLICY IF EXISTS "Authenticated only" ON sales_order_lines';
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'sales_order_lines' AND policyname = 'Company scoped via sales_order') THEN
      CREATE POLICY "Company scoped via sales_order" ON sales_order_lines
        FOR ALL USING (
          auth.role() = 'authenticated'
          AND EXISTS (SELECT 1 FROM sales_orders o WHERE o.id = sales_order_lines.sales_order_id AND user_can_access_company(o.company_id))
        )
        WITH CHECK (
          auth.role() = 'authenticated'
          AND EXISTS (SELECT 1 FROM sales_orders o WHERE o.id = sales_order_lines.sales_order_id AND user_can_access_company(o.company_id))
        );
    END IF;
  END IF;
END $$;
