-- "Yaltechane" (shortage) tracking: materials that came up short/missing on
-- an order get flagged against the supplier, so they surface as a reminder
-- when starting the next order with that same supplier ("should be noted
-- and ordered on the next order of the same company").
create table if not exists supplier_shortage_notes (
  id uuid primary key default gen_random_uuid(),
  supplier_id uuid not null references suppliers(id) on delete cascade,
  product_id uuid references products(id) on delete set null,
  shipment_id uuid references shipments(id) on delete set null,
  quantity_short numeric(12,2),
  notes text,
  is_resolved boolean not null default false,
  created_at timestamptz not null default now(),
  resolved_at timestamptz
);

create index if not exists idx_supplier_shortage_notes_supplier on supplier_shortage_notes(supplier_id) where not is_resolved;

alter table supplier_shortage_notes enable row level security;

drop policy if exists "select_active_role" on supplier_shortage_notes;
create policy "select_active_role" on supplier_shortage_notes for select using (has_active_role());

drop policy if exists "write_scoped" on supplier_shortage_notes;
create policy "write_scoped" on supplier_shortage_notes for all
  using (has_role(ARRAY['operations_marketing','manufacturing_sales']))
  with check (has_role(ARRAY['operations_marketing','manufacturing_sales']));
