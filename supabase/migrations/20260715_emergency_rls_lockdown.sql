-- EMERGENCY: close public (anonymous) read/write access to production data.
--
-- Verified live on 2026-07-15 via the app's own anon key (the same key
-- shipped in the browser bundle — anyone can extract it from dev tools):
-- shipments, shipment_expenses, sales_orders, customers, credit_accounts,
-- company_expenses, inventory_ledger, warehouses, shipment_items,
-- forex_rates, company_settings, bom_headers, production_orders, suppliers,
-- and products were ALL readable with no login at all. Root cause: several
-- policies were written as `USING (true)` ("Allow all"), which in Postgres
-- RLS grants access to literally everyone, including unauthenticated
-- requests — not just logged-in users of the app as the name implied.
--
-- This migration is a first-response lockdown: it restricts every listed
-- table to authenticated sessions only (matching how the app already
-- behaves today — the frontend already assumes any logged-in user has full
-- access via the src/api/* layer). It does NOT add per-role/department
-- scoping yet — that is a follow-up once company_id / company_members
-- (see 20260715_multicompany_warehouses.sql) are in place and tested.
--
-- HOW TO APPLY: paste this whole file into the Supabase Dashboard's SQL
-- Editor and run it now. It only tightens existing "allow true" policies —
-- it does not change any data.

DO $$
DECLARE
  t text;
  tables text[] := ARRAY[
    'profiles', 'companies', 'employees',
    'shipments', 'shipment_items', 'shipment_expenses', 'shipment_attachments',
    'sales_orders', 'sales_order_lines',
    'purchase_orders',
    'customers', 'credit_accounts', 'credit_transactions',
    'suppliers', 'products',
    'company_expenses', 'company_settings',
    'inventory_ledger', 'warehouses',
    'forex_rates', 'consignees',
    'bom_headers', 'bom_lines',
    'production_orders', 'production_daily_logs'
  ];
BEGIN
  FOREACH t IN ARRAY tables LOOP
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = t) THEN
      EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);

      -- Drop any existing USING(true)-style "allow all" policy so it can't
      -- keep granting anonymous access alongside the new one.
      EXECUTE (
        SELECT COALESCE(string_agg(
          format('DROP POLICY %I ON public.%I;', policyname, t), ' '
        ), '')
        FROM pg_policies
        WHERE schemaname = 'public' AND tablename = t
          AND (qual = 'true' OR with_check = 'true')
      );

      IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'public' AND tablename = t AND policyname = 'Authenticated only'
      ) THEN
        EXECUTE format(
          'CREATE POLICY "Authenticated only" ON public.%I FOR ALL USING (auth.role() = ''authenticated'') WITH CHECK (auth.role() = ''authenticated'')',
          t
        );
      END IF;
    END IF;
  END LOOP;
END $$;
