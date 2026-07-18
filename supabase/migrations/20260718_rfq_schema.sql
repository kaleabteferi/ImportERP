-- Supplier RFQ/quotation schema. Fills the gap between "we need to reorder"
-- and "we created a shipment" — previously there was nowhere to log
-- multiple suppliers' pricing for the same sourcing need except a notes
-- field. v1 scope: raw quoted price comparison only (no landed-cost
-- normalization — that can layer on top later via Cost Engine once a
-- winner is picked and becomes a real shipment).

create table if not exists rfqs (
  id uuid primary key default gen_random_uuid(),
  company_id uuid references companies(id),
  reference text not null,
  status text not null default 'draft' check (status in ('draft', 'sent', 'awarded', 'closed')),
  notes text,
  created_at timestamptz not null default now(),
  -- Set once a quote is awarded and turned into a real shipment, so the
  -- RFQ traces forward to what it became instead of just sitting closed.
  awarded_shipment_id uuid references shipments(id)
);

create table if not exists rfq_lines (
  id uuid primary key default gen_random_uuid(),
  rfq_id uuid not null references rfqs(id) on delete cascade,
  product_id uuid not null references products(id),
  quantity_requested numeric not null check (quantity_requested > 0)
);

create table if not exists rfq_supplier_quotes (
  id uuid primary key default gen_random_uuid(),
  rfq_id uuid not null references rfqs(id) on delete cascade,
  supplier_id uuid not null references suppliers(id),
  status text not null default 'invited' check (status in ('invited', 'quoted', 'declined')),
  currency text not null default 'USD',
  payment_terms text,
  lead_time_days int,
  valid_until date,
  notes text,
  created_at timestamptz not null default now(),
  unique (rfq_id, supplier_id)
);

create table if not exists rfq_quote_lines (
  id uuid primary key default gen_random_uuid(),
  rfq_supplier_quote_id uuid not null references rfq_supplier_quotes(id) on delete cascade,
  rfq_line_id uuid not null references rfq_lines(id) on delete cascade,
  unit_price numeric,
  moq numeric,
  notes text,
  unique (rfq_supplier_quote_id, rfq_line_id)
);

alter table rfqs enable row level security;
alter table rfq_lines enable row level security;
alter table rfq_supplier_quotes enable row level security;
alter table rfq_quote_lines enable row level security;

-- Same shape as every other operations_marketing-owned, company-scoped
-- table (see 20260717_harden_rls_by_role.sql / 20260716_company_scoped_rls.sql):
-- broad select for any active role that can see the company, write scoped
-- to operations_marketing. accounting_finance can also write, matching
-- Shipments (they can create/finalize shipments too, and awarding a quote
-- creates one).
create policy "select_active_role" on rfqs for select using (has_active_role() and user_can_access_company(company_id));
create policy "write_scoped" on rfqs for all
  using (has_role(ARRAY['operations_marketing', 'accounting_finance']) and user_can_access_company(company_id))
  with check (has_role(ARRAY['operations_marketing', 'accounting_finance']) and user_can_access_company(company_id));

create policy "select_active_role" on rfq_lines for select using (
  has_active_role() and exists (select 1 from rfqs r where r.id = rfq_lines.rfq_id and user_can_access_company(r.company_id))
);
create policy "write_scoped" on rfq_lines for all
  using (has_role(ARRAY['operations_marketing', 'accounting_finance']) and exists (select 1 from rfqs r where r.id = rfq_lines.rfq_id and user_can_access_company(r.company_id)))
  with check (has_role(ARRAY['operations_marketing', 'accounting_finance']) and exists (select 1 from rfqs r where r.id = rfq_lines.rfq_id and user_can_access_company(r.company_id)));

create policy "select_active_role" on rfq_supplier_quotes for select using (
  has_active_role() and exists (select 1 from rfqs r where r.id = rfq_supplier_quotes.rfq_id and user_can_access_company(r.company_id))
);
create policy "write_scoped" on rfq_supplier_quotes for all
  using (has_role(ARRAY['operations_marketing', 'accounting_finance']) and exists (select 1 from rfqs r where r.id = rfq_supplier_quotes.rfq_id and user_can_access_company(r.company_id)))
  with check (has_role(ARRAY['operations_marketing', 'accounting_finance']) and exists (select 1 from rfqs r where r.id = rfq_supplier_quotes.rfq_id and user_can_access_company(r.company_id)));

create policy "select_active_role" on rfq_quote_lines for select using (
  has_active_role() and exists (
    select 1 from rfq_supplier_quotes q join rfqs r on r.id = q.rfq_id
    where q.id = rfq_quote_lines.rfq_supplier_quote_id and user_can_access_company(r.company_id)
  )
);
create policy "write_scoped" on rfq_quote_lines for all
  using (has_role(ARRAY['operations_marketing', 'accounting_finance']) and exists (
    select 1 from rfq_supplier_quotes q join rfqs r on r.id = q.rfq_id
    where q.id = rfq_quote_lines.rfq_supplier_quote_id and user_can_access_company(r.company_id)
  ))
  with check (has_role(ARRAY['operations_marketing', 'accounting_finance']) and exists (
    select 1 from rfq_supplier_quotes q join rfqs r on r.id = q.rfq_id
    where q.id = rfq_quote_lines.rfq_supplier_quote_id and user_can_access_company(r.company_id)
  ));
