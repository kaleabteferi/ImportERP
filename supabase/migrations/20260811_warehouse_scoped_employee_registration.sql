-- Let a warehouse_manager register and manage employees for their own
-- warehouse without opening up the company-wide HR employees page (still
-- hr_system-only). These are additive policies -- they only grant access,
-- never restrict the existing HR-only policies.

create policy "warehouse_manager_view_own_employees"
on employees
for select
using (
  exists (
    select 1
    from operational_units ou
    where ou.warehouse_id = employees.warehouse_id
      and user_can_manage_operational_unit(ou.id)
  )
);

create policy "warehouse_manager_register_own_employees"
on employees
for insert
with check (
  exists (
    select 1
    from operational_units ou
    where ou.warehouse_id = employees.warehouse_id
      and user_can_manage_operational_unit(ou.id)
  )
);

-- Update only -- no delete policy for warehouse managers. Deactivate via
-- is_active instead of deleting an employee record with payroll/attendance
-- history attached.
create policy "warehouse_manager_update_own_employees"
on employees
for update
using (
  exists (
    select 1
    from operational_units ou
    where ou.warehouse_id = employees.warehouse_id
      and user_can_manage_operational_unit(ou.id)
  )
)
with check (
  exists (
    select 1
    from operational_units ou
    where ou.warehouse_id = employees.warehouse_id
      and user_can_manage_operational_unit(ou.id)
  )
);
