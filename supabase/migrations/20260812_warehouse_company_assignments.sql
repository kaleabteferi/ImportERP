-- Real company ownership per warehouse, a new relief-storage warehouse, and
-- deactivating Main Warehouse (reversible -- data stays, just hidden from
-- active selection lists). Also adds a trigger so any warehouse created from
-- now on automatically gets its operational unit / cost center / payroll
-- scope / default shift provisioned -- this previously only happened for the
-- 7 warehouses that existed when the warehouse-ops module was first seeded.

insert into warehouses (name, code, is_active, has_production)
select 'Merkato Releaf', 'MKT-RELEAF', true, false
where not exists (select 1 from warehouses where name = 'Merkato Releaf');

update warehouses set is_active = false where name = 'Main Warehouse';
update operational_units ou set is_active = false
from warehouses w where w.id = ou.warehouse_id and w.name = 'Main Warehouse';

-- Backfill operational_units/cost_centers/payroll_scopes/shifts for any
-- active warehouse missing them (covers Merkato Releaf right now).
insert into cost_centers(code, name)
select 'WH-' || coalesce(nullif(w.code,''), upper(left(replace(w.name,' ',''),8))), w.name || ' Operations'
from warehouses w
where w.is_active
on conflict(code) do nothing;

insert into operational_units(warehouse_id, cost_center_id, name, code, unit_type)
select
  w.id, c.id, w.name || ' Operations',
  coalesce(nullif(w.code,''), upper(left(replace(w.name,' ',''),8))) || '-OPS',
  case when coalesce(w.has_production,false) then 'factory' else 'warehouse' end
from warehouses w
left join cost_centers c on c.code = 'WH-' || coalesce(nullif(w.code,''), upper(left(replace(w.name,' ',''),8)))
where w.is_active
on conflict(code) do nothing;

insert into payroll_scopes(name, scope_type, operational_unit_id, company_id, cost_center_id)
select
  ou.name || ' Payroll',
  case when ou.unit_type = 'factory' then 'factory' else 'warehouse' end,
  ou.id, ou.company_id, ou.cost_center_id
from operational_units ou
where not exists (select 1 from payroll_scopes ps where ps.operational_unit_id = ou.id);

insert into operational_shifts(operational_unit_id, name, start_time, end_time, standard_hours, overtime_after_hours)
select ou.id, 'Morning Shift', '07:00'::time, '15:00'::time, 8, 8
from operational_units ou
where not exists (select 1 from operational_shifts s where s.operational_unit_id = ou.id and s.name = 'Morning Shift');

-- Company ownership per warehouse.
update operational_units ou set company_id = (select id from companies where name = 'Bisrat''s company')
from warehouses w where w.id = ou.warehouse_id and w.name in ('Addisu Gebeya', 'Merkato B');

update operational_units ou set company_id = (select id from companies where name = 'Kaleab''s company')
from warehouses w where w.id = ou.warehouse_id and w.name in ('Jemo', 'Merkato K', 'Merkato Releaf');

update operational_units ou set company_id = (select id from companies where name = 'HBK Trading PLC')
from warehouses w where w.id = ou.warehouse_id and w.name = 'Debre Berhan';

-- Ali - Djibouti is intentionally left unassigned -- company wasn't specified.

-- Auto-provision the operational unit (+ cost center, payroll scope, default
-- shift) whenever a new warehouse is created or reactivated, so this never
-- has to be a manual migration again.
create or replace function provision_operational_unit_for_warehouse()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_code text;
  v_cost_center_id uuid;
  v_unit_id uuid;
begin
  if not new.is_active then return new; end if;
  v_code := coalesce(nullif(new.code,''), upper(left(replace(new.name,' ',''),8)));

  insert into cost_centers(code, name)
  values ('WH-' || v_code, new.name || ' Operations')
  on conflict(code) do update set name = excluded.name
  returning id into v_cost_center_id;

  insert into operational_units(warehouse_id, cost_center_id, name, code, unit_type)
  values (
    new.id, v_cost_center_id, new.name || ' Operations', v_code || '-OPS',
    case when coalesce(new.has_production,false) then 'factory' else 'warehouse' end
  )
  on conflict(code) do update set warehouse_id = excluded.warehouse_id, is_active = true
  returning id into v_unit_id;

  insert into payroll_scopes(name, scope_type, operational_unit_id, cost_center_id)
  select
    new.name || ' Payroll',
    case when coalesce(new.has_production,false) then 'factory' else 'warehouse' end,
    v_unit_id, v_cost_center_id
  where not exists (select 1 from payroll_scopes where operational_unit_id = v_unit_id);

  insert into operational_shifts(operational_unit_id, name, start_time, end_time, standard_hours, overtime_after_hours)
  select v_unit_id, 'Morning Shift', '07:00'::time, '15:00'::time, 8, 8
  where not exists (select 1 from operational_shifts where operational_unit_id = v_unit_id and name = 'Morning Shift');

  return new;
end;
$$;

drop trigger if exists trg_provision_operational_unit_for_warehouse on warehouses;
create trigger trg_provision_operational_unit_for_warehouse
after insert or update of is_active
on warehouses
for each row
when (new.is_active)
execute function provision_operational_unit_for_warehouse();

revoke all on function provision_operational_unit_for_warehouse() from public;
