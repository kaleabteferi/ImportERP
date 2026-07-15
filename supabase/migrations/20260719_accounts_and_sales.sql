-- Bank/cash Accounts, so payments can record WHICH account received or
-- paid the money (e.g. "400,000 ETB via transfer -> CBE - HBK PLC"), not
-- just a generic payment method.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'accounts'
  ) THEN
    CREATE TABLE accounts (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      name text NOT NULL,
      type text NOT NULL DEFAULT 'bank' CHECK (type IN ('cash', 'bank')),
      currency text NOT NULL DEFAULT 'ETB',
      company_id uuid REFERENCES companies(id),
      is_active boolean NOT NULL DEFAULT true,
      created_at timestamptz NOT NULL DEFAULT now()
    );
  END IF;
END $$;

ALTER TABLE accounts ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'accounts' AND policyname = 'Authenticated only'
  ) THEN
    CREATE POLICY "Authenticated only" ON accounts
      FOR ALL USING (auth.role() = 'authenticated') WITH CHECK (auth.role() = 'authenticated');
  END IF;
END $$;

-- Which account actually received/paid the money, on every table that
-- records a real cash movement.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='sales_payments') THEN
    ALTER TABLE sales_payments ADD COLUMN IF NOT EXISTS account_id uuid REFERENCES accounts(id);
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='purchase_order_payments') THEN
    ALTER TABLE purchase_order_payments ADD COLUMN IF NOT EXISTS account_id uuid REFERENCES accounts(id);
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='company_expenses') THEN
    ALTER TABLE company_expenses ADD COLUMN IF NOT EXISTS account_id uuid REFERENCES accounts(id);
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='credit_transactions') THEN
    ALTER TABLE credit_transactions ADD COLUMN IF NOT EXISTS account_id uuid REFERENCES accounts(id);
  END IF;
END $$;
