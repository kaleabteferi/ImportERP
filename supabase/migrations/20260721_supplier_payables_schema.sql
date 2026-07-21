-- Supplier payables + payments. Fills a real gap: purchase_orders exists
-- in the schema but nothing in the app ever creates a row in it (confirmed
-- via code search — no INSERT path anywhere), so "how much do we owe a
-- supplier for goods, how much has been paid, how much is left" had no
-- working mechanism. This is a fresh, purpose-built replacement, entered
-- manually (optionally linked to a shipment) since debt isn't always
-- 1:1 with a single shipment (combined orders, open credit lines).
--
-- Payments support hawala specifically, since that's how this business
-- actually converts ETB into the CNY/USD a supplier is owed in: the ETB
-- amount handed to the dealer, the rate they quoted, and the resulting
-- foreign-currency amount that actually pays down the debt, plus which
-- route/dealer was used. Non-hawala payments (bank transfer, cash, other)
-- just record the amount directly in the payable's own currency.

create table supplier_payables (
  id uuid primary key default gen_random_uuid(),
  company_id uuid references companies(id),
  supplier_id uuid not null references suppliers(id),
  shipment_id uuid references shipments(id),
  reference text,
  currency currency_code not null default 'USD',
  total_amount numeric not null check (total_amount > 0),
  paid_amount numeric not null default 0,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table supplier_payments (
  id uuid primary key default gen_random_uuid(),
  payable_id uuid not null references supplier_payables(id) on delete cascade,
  payment_date date not null default current_date,
  method text not null check (method in ('hawala', 'bank_transfer', 'cash', 'other')),
  -- Amount in the payable's own currency — this is what reduces the debt,
  -- regardless of payment method.
  amount numeric not null check (amount > 0),
  -- Funding source: which cash pool the money came out of (same mechanism
  -- every other payment type in this app already uses), plus an optional
  -- link to the specific sale that funded it and/or a free-text note —
  -- covers "was it from a specific sale or just collected cash" without
  -- building a full cash-allocation/waterfall system.
  account_id uuid references accounts(id),
  source_sales_order_id uuid references sales_orders(id),
  source_note text,
  -- Hawala-specific detail — only meaningful when method = 'hawala'.
  hawala_route text,
  etb_amount numeric,
  exchange_rate numeric,
  reference text,
  sensitive_flag boolean not null default false,
  notes text,
  created_at timestamptz not null default now(),
  paid_by uuid references profiles(id)
);

create or replace function sync_supplier_payable_paid_amount()
returns trigger
language plpgsql
as $$
declare
  v_payable_id uuid := coalesce(new.payable_id, old.payable_id);
  v_total numeric;
begin
  select coalesce(sum(amount), 0) into v_total from supplier_payments where payable_id = v_payable_id;
  update supplier_payables set paid_amount = v_total, updated_at = now() where id = v_payable_id;
  return coalesce(new, old);
end;
$$;

create trigger trg_sync_supplier_payable_paid_amount
after insert or update or delete on supplier_payments
for each row execute function sync_supplier_payable_paid_amount();

alter table supplier_payables enable row level security;
alter table supplier_payments enable row level security;

-- Same shape as every other operations_marketing/accounting_finance-owned,
-- company-scoped table in this app (see RFQ schema for the identical
-- pattern) — broad read for any active role that can see the company,
-- write scoped to the two roles that actually touch supplier money.
create policy "select_active_role" on supplier_payables for select using (has_active_role() and user_can_access_company(company_id));
create policy "write_scoped" on supplier_payables for all
  using (has_role(array['operations_marketing','accounting_finance']) and user_can_access_company(company_id))
  with check (has_role(array['operations_marketing','accounting_finance']) and user_can_access_company(company_id));

create policy "select_active_role" on supplier_payments for select using (
  has_active_role() and exists (select 1 from supplier_payables p where p.id = supplier_payments.payable_id and user_can_access_company(p.company_id))
);
create policy "write_scoped" on supplier_payments for all
  using (has_role(array['operations_marketing','accounting_finance']) and exists (select 1 from supplier_payables p where p.id = supplier_payments.payable_id and user_can_access_company(p.company_id)))
  with check (has_role(array['operations_marketing','accounting_finance']) and exists (select 1 from supplier_payables p where p.id = supplier_payments.payable_id and user_can_access_company(p.company_id)));
