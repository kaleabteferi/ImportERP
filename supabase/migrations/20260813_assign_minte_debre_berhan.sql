-- Minte is the registered manager for Debre Berhan. Ali - Djibouti is
-- intentionally left with no company_id and no manager assignment -- it is
-- a third-party forwarding/staging point in Djibouti (goods land there from
-- China, then get partially forwarded to the real warehouses), not one of
-- our owned facilities, so it should not carry cost-center/payroll weight.
-- It stays visible to full_access only, per the existing null-company RLS
-- behavior -- no schema change needed for that.

do $$
declare
  v_warehouse_id uuid;
  v_employee_id uuid;
  v_match_count integer;
begin
  select id into v_warehouse_id from warehouses where name = 'Debre Berhan';
  if v_warehouse_id is null then
    raise notice 'Debre Berhan warehouse not found -- skipping Minte assignment';
    return;
  end if;

  select count(*) into v_match_count from employees where full_name ilike '%minte%';
  if v_match_count = 0 then
    raise notice 'No employee named Minte found -- register him first (Warehouse Ops > Workforce > Register employee, scoped to Debre Berhan), then rerun this migration';
    return;
  end if;
  if v_match_count > 1 then
    raise notice '% employees match "Minte" -- assignment skipped, resolve the name manually and set warehouses.production_manager_employee_id directly', v_match_count;
    return;
  end if;

  select id into v_employee_id from employees where full_name ilike '%minte%';

  -- Make sure his employee record itself is scoped to Debre Berhan (fixes
  -- it if he was registered against the wrong warehouse or none at all).
  update employees set warehouse_id = v_warehouse_id where id = v_employee_id;

  -- This is the field the existing sync trigger watches -- setting it
  -- automatically creates (or reactivates) his warehouse_manager
  -- assignment once his login profile is linked to this employee record.
  update warehouses set production_manager_employee_id = v_employee_id where id = v_warehouse_id;

  raise notice 'Minte (employee %) assigned as manager of Debre Berhan (warehouse %)', v_employee_id, v_warehouse_id;
end $$;
