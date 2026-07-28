-- Djibouti timeline rework: separate Port fee + Demurrage charges, a flat WH
-- (warehouse) fee replacing Port storage, and a new reconciliation table for
-- service charges paid to Ali (the Djibouti forwarder) vs. what he actually
-- invoiced.
--
-- This feature already posts real numbers into shipment_expenses, which
-- feeds the business's live Money Tracking/Payables -- every change here is
-- additive and must not alter any number already saved for an existing
-- shipment. New numeric columns default to 0 specifically so this migration
-- backfills every existing demurrage_rates row to "no charge" rather than a
-- realistic-looking nonzero rate that could look like real data or trigger
-- the auto-sync effect on shipments nobody touched. Realistic starting
-- values (7 free days / $20 port fee; $70 flat demurrage; $15/day WH) live
-- only in TimelinePanel's frontend fallback state, exactly like the existing
-- hardcoded demurrage/detention defaults already do for brand-new shipments.

alter table demurrage_rates add column if not exists port_free_days integer not null default 0;
alter table demurrage_rates add column if not exists port_rate_usd_per_day numeric(10,2) not null default 0;
alter table demurrage_rates add column if not exists wh_free_days integer not null default 0;
alter table demurrage_rates add column if not exists wh_rate_usd_per_day numeric(10,2) not null default 0;

comment on column demurrage_rates.stor_free_days is
  'DEPRECATED -- superseded by wh_free_days/wh_rate_usd_per_day. Kept for historical/audit reference only; no longer read or written by application code.';
comment on column demurrage_rates.stor_rate_etb_per_m3 is
  'DEPRECATED -- superseded by wh_rate_usd_per_day (flat USD/day, not ETB/m3). Kept for historical/audit reference only; no longer read or written by application code.';

create table if not exists shipment_ali_charges (
  id uuid primary key default gen_random_uuid(),
  shipment_id uuid not null references shipments(id) on delete cascade,
  charge_type text not null check (charge_type in (
    'DELIVERY_ORDER','DECLARATION_FEE','TRANSFER_FEE','LABOR','FORKLIFT','ECTN','SERVICE_CHARGE','OTHER'
  )),
  custom_label text,
  expected_amount numeric(12,2),
  actual_amount numeric(12,2),
  currency text not null default 'USD' check (currency in ('USD','ETB','CNY')),
  fx_rate_at_entry numeric(12,4),
  is_reconciled boolean not null default false,
  synced_expense_id uuid references shipment_expenses(id) on delete set null,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_shipment_ali_charges_shipment on shipment_ali_charges(shipment_id);

alter table shipment_ali_charges enable row level security;

drop policy if exists "select_active_role" on shipment_ali_charges;
create policy "select_active_role" on shipment_ali_charges for select using (
  has_active_role() and exists (
    select 1 from shipments s where s.id = shipment_ali_charges.shipment_id and user_can_access_company(s.company_id)
  )
);

drop policy if exists "write_scoped" on shipment_ali_charges;
create policy "write_scoped" on shipment_ali_charges for all
  using (
    has_role(ARRAY['operations_marketing','accounting_finance'])
    and exists (select 1 from shipments s where s.id = shipment_ali_charges.shipment_id and user_can_access_company(s.company_id))
  )
  with check (
    has_role(ARRAY['operations_marketing','accounting_finance'])
    and exists (select 1 from shipments s where s.id = shipment_ali_charges.shipment_id and user_can_access_company(s.company_id))
  );
