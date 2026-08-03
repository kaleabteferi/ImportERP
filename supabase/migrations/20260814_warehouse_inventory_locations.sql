-- Phase 1: inventory placement. Where inside a warehouse a product actually
-- sits, not just which warehouse holds it. Existing inventory_ledger rows
-- are untouched (location_id stays null on them, showing as "not yet
-- placed") -- this is additive, not a retrofit of every receiving/
-- production write path.

-- movement_type is a Postgres enum (inventory_movement_type), not free
-- text -- the location-move RPC below needs its own value.
alter type inventory_movement_type add value if not exists 'LOCATION_MOVE';

create table if not exists warehouse_locations (
  id uuid primary key default gen_random_uuid(),
  warehouse_id uuid not null references warehouses(id),
  code text not null,
  name text,
  location_type text not null default 'shelf'
    check (location_type in ('zone','aisle','shelf','bin','floor','staging')),
  parent_location_id uuid references warehouse_locations(id),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  unique(warehouse_id, code)
);
create index if not exists idx_warehouse_locations_warehouse on warehouse_locations(warehouse_id) where is_active;

alter table inventory_ledger add column if not exists location_id uuid references warehouse_locations(id);
create index if not exists idx_inventory_ledger_location on inventory_ledger(location_id) where location_id is not null;

-- Plain view, not materialized -- location-level stock changes far less
-- often per-row than it's read, and this avoids chasing every existing
-- "refresh materialized view current_inventory" call site across the
-- codebase to also refresh a second view.
create or replace view current_inventory_by_location as
select warehouse_id, location_id, product_id, sum(quantity) as quantity_on_hand
from inventory_ledger
where location_id is not null
group by warehouse_id, location_id, product_id
having sum(quantity) <> 0;
grant select on current_inventory_by_location to authenticated;

create or replace view current_inventory_unplaced as
select warehouse_id, product_id, sum(quantity) as quantity_on_hand
from inventory_ledger
where location_id is null
group by warehouse_id, product_id
having sum(quantity) <> 0;
grant select on current_inventory_unplaced to authenticated;

-- One default "Receiving / Unassigned" location per active warehouse so the
-- UI has somewhere concrete to point at for not-yet-placed stock, and staff
-- have a real location to move *from* the first time they place something.
insert into warehouse_locations(warehouse_id, code, name, location_type)
select w.id, 'RECEIVING', 'Receiving / Unassigned', 'staging'
from warehouses w
where w.is_active
on conflict(warehouse_id, code) do nothing;

alter table warehouse_locations enable row level security;

create policy "view_warehouse_locations" on warehouse_locations for select using (
  exists (
    select 1 from operational_units ou
    where ou.warehouse_id = warehouse_locations.warehouse_id
      and user_can_view_operational_unit(ou.id)
  )
);
create policy "manage_warehouse_locations" on warehouse_locations for all using (
  exists (
    select 1 from operational_units ou
    where ou.warehouse_id = warehouse_locations.warehouse_id
      and user_can_manage_operational_unit(ou.id)
  )
) with check (
  exists (
    select 1 from operational_units ou
    where ou.warehouse_id = warehouse_locations.warehouse_id
      and user_can_manage_operational_unit(ou.id)
  )
);

-- Moves quantity from one location to another within the same warehouse as
-- a paired zero-financial-impact adjustment (no cost/quantity is created or
-- destroyed, only relocated) -- this is the actual put-away/relocate action.
-- p_from_location_id may be NULL, meaning "the not-yet-placed pool" -- most
-- existing stock (received/produced before this feature existed, or by a
-- write path that doesn't set a location yet) has location_id null, and
-- placing it onto a real shelf for the first time is the main use case.
create or replace function move_inventory_location(
  p_warehouse_id uuid,
  p_product_id uuid,
  p_from_location_id uuid,
  p_to_location_id uuid,
  p_quantity numeric,
  p_notes text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_unit_id uuid;
  v_available numeric;
  v_unit_cost numeric;
begin
  if auth.uid() is null then
    raise exception using errcode = '42501', message = 'Your session has expired. Sign in again.';
  end if;

  select ou.id into v_unit_id
  from operational_units ou
  where ou.warehouse_id = p_warehouse_id
  limit 1;

  if v_unit_id is null or not user_can_manage_operational_unit(v_unit_id) then
    raise exception using errcode = '42501', message = 'A current warehouse-manager assignment is required to relocate stock here.';
  end if;

  if p_quantity is null or p_quantity <= 0 then
    raise exception 'Quantity to move must be greater than zero.';
  end if;

  if p_to_location_id is null then
    raise exception 'Select a destination location.';
  end if;
  if p_from_location_id is not distinct from p_to_location_id then
    raise exception 'Source and destination location must be different.';
  end if;

  if p_from_location_id is not null
    and not exists (select 1 from warehouse_locations where id = p_from_location_id and warehouse_id = p_warehouse_id) then
    raise exception 'The source location does not belong to this warehouse.';
  end if;
  if not exists (select 1 from warehouse_locations where id = p_to_location_id and warehouse_id = p_warehouse_id and is_active) then
    raise exception 'The destination location does not belong to this warehouse or is inactive.';
  end if;

  select coalesce(sum(quantity), 0) into v_available
  from inventory_ledger
  where warehouse_id = p_warehouse_id and product_id = p_product_id
    and location_id is not distinct from p_from_location_id;

  if v_available < p_quantity then
    raise exception 'Only % units of this product are available at the source (%), cannot move %.',
      v_available, coalesce((select code from warehouse_locations where id = p_from_location_id), 'not yet placed'), p_quantity;
  end if;

  select coalesce(sum(quantity * unit_cost_etb) / nullif(sum(quantity), 0), 0) into v_unit_cost
  from inventory_ledger
  where warehouse_id = p_warehouse_id and product_id = p_product_id
    and quantity > 0 and unit_cost_etb is not null;

  insert into inventory_ledger(warehouse_id, product_id, movement_type, quantity, unit_cost_etb, movement_date, location_id, reference_type, notes)
  values (p_warehouse_id, p_product_id, 'LOCATION_MOVE', -p_quantity, v_unit_cost, current_date, p_from_location_id, 'location_move', coalesce(p_notes, 'Moved to another location'));

  insert into inventory_ledger(warehouse_id, product_id, movement_type, quantity, unit_cost_etb, movement_date, location_id, reference_type, notes)
  values (p_warehouse_id, p_product_id, 'LOCATION_MOVE', p_quantity, v_unit_cost, current_date, p_to_location_id, 'location_move', coalesce(p_notes, 'Moved from another location'));
end;
$$;

revoke all on function move_inventory_location(uuid, uuid, uuid, uuid, numeric, text) from public;
grant execute on function move_inventory_location(uuid, uuid, uuid, uuid, numeric, text) to authenticated;
