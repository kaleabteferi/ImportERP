-- Give full_access (owner) implicit warehouse-manager rights everywhere.
-- Owners could already view and approve every operational unit, but manage
-- actions (create/edit production batches and workers, workforce groups,
-- shifts, attendance, overtime requests) required an explicit
-- warehouse_user_assignments row. This closes that gap: full_access no
-- longer needs a per-warehouse assignment to act as a manager.

create or replace function user_can_manage_operational_unit(p_unit_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    current_role_name() = 'full_access'
    or has_warehouse_assignment(p_unit_id, array['warehouse_manager']);
$$;
