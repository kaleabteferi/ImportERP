-- Company scoping for production orders/batches is not configured yet — none
-- of the 7 operational units have a company_id, so every existing production
-- order was created before that migration and has company_id = null. Until
-- warehouses are actually mapped to companies, treat company scope as
-- optional everywhere instead of a hard blocker. Access checks still run
-- whenever a company IS present; only the "must have a company" requirement
-- is relaxed.

create or replace function production_batch_matches_unit(
  p_operational_unit_id uuid,
  p_warehouse_id uuid,
  p_production_order_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from operational_units ou
    where ou.id = p_operational_unit_id
      and (
        p_warehouse_id is null
        or ou.warehouse_id = p_warehouse_id
      )
      and (
        p_production_order_id is null
        or exists (
          select 1
          from production_orders po
          where po.id = p_production_order_id
            and po.warehouse_id = ou.warehouse_id
            and (
              po.company_id is null
              or user_can_access_company(po.company_id)
              or user_can_manage_operational_unit(ou.id)
            )
            and (
              ou.company_id is null
              or po.company_id is null
              or po.company_id is not distinct from ou.company_id
            )
        )
      )
  );
$$;

create or replace function enforce_production_order_company_scope()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.company_id is not null and not user_can_access_company(new.company_id) then
    raise exception using
      errcode = '42501',
      message = 'The production order company is outside your access scope.';
  end if;

  if tg_op = 'UPDATE'
    and old.company_id is distinct from new.company_id
    and (
      exists (
        select 1
        from production_batches b
        where b.production_order_id = old.id
          and b.status <> 'cancelled'
      )
      or exists (
        select 1
        from production_daily_logs l
        where l.production_order_id = old.id
      )
    ) then
    raise exception 'A production order with floor activity cannot be moved to another company.';
  end if;

  return new;
end;
$$;

create or replace function create_warehouse_production_order(
  p_operational_unit_id uuid,
  p_company_id uuid,
  p_bom_header_id uuid,
  p_target_quantity numeric,
  p_planned_start_date date,
  p_due_date date,
  p_notes text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_unit operational_units%rowtype;
  v_bom bom_headers%rowtype;
  v_order_id uuid;
  v_order_number text;
begin
  if auth.uid() is null then
    raise exception using
      errcode = '42501',
      message = 'Your session has expired. Sign in again before creating a production order.';
  end if;

  if not has_role(array['manufacturing_sales']) then
    raise exception using
      errcode = '42501',
      message = 'Production planning access is required to create production orders.';
  end if;

  select *
  into v_unit
  from operational_units
  where id = p_operational_unit_id
    and is_active;

  if not found or v_unit.warehouse_id is null then
    raise exception 'The selected operational unit is not connected to an active warehouse.';
  end if;

  if not exists (
    select 1 from warehouses w
    where w.id = v_unit.warehouse_id and w.is_active
  ) then
    raise exception 'The selected operational unit warehouse is not active.';
  end if;

  if not (
    user_can_view_operational_unit(p_operational_unit_id)
    or user_can_plan_production_unit(p_operational_unit_id)
  ) then
    raise exception using
      errcode = '42501',
      message = 'This operational unit is outside your production planning scope.';
  end if;

  if p_company_id is not null then
    if not exists (
      select 1
      from companies c
      where c.id = p_company_id
        and c.is_active
    ) then
      raise exception 'The selected company is inactive or no longer exists.';
    end if;

    if not user_can_access_company(p_company_id) then
      raise exception using
        errcode = '42501',
        message = 'The selected company is outside your production planning scope.';
    end if;

    if v_unit.company_id is not null
      and v_unit.company_id is distinct from p_company_id then
      raise exception 'The selected operational unit is assigned to a different company.';
    end if;
  end if;

  select *
  into v_bom
  from bom_headers
  where id = p_bom_header_id
    and is_active;

  if not found then
    raise exception 'Select an active BOM before creating the production order.';
  end if;

  if coalesce(v_bom.finished_product_id, v_bom.product_id) is null then
    raise exception 'The selected BOM does not identify a finished product.';
  end if;

  if p_target_quantity is null or p_target_quantity <= 0 then
    raise exception 'Target quantity must be greater than zero.';
  end if;

  if p_due_date is not null
    and p_planned_start_date is not null
    and p_due_date < p_planned_start_date then
    raise exception 'The due date cannot be earlier than the planned start date.';
  end if;

  v_order_number :=
    'PROD-'
    || to_char(coalesce(p_planned_start_date, current_date), 'YYYYMMDD')
    || '-'
    || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 6));

  insert into production_orders (
    order_number,
    company_id,
    warehouse_id,
    product_id,
    bom_header_id,
    target_quantity,
    completed_quantity,
    status,
    planned_start_date,
    due_date,
    labor_cost_etb,
    notes
  )
  values (
    v_order_number,
    p_company_id,
    v_unit.warehouse_id,
    coalesce(v_bom.finished_product_id, v_bom.product_id),
    v_bom.id,
    p_target_quantity,
    0,
    'DRAFT',
    coalesce(p_planned_start_date, current_date),
    p_due_date,
    0,
    nullif(trim(p_notes), '')
  )
  returning id into v_order_id;

  return v_order_id;
end;
$$;

create or replace function create_production_batch_with_workers(
  p_operational_unit_id uuid,
  p_warehouse_id uuid,
  p_task_type_id uuid,
  p_shift_id uuid,
  p_production_date date,
  p_target_units numeric,
  p_actual_units numeric,
  p_rejected_units numeric,
  p_allocation_method text,
  p_status text,
  p_supervisor_employee_id uuid,
  p_production_order_id uuid,
  p_bom_header_id uuid,
  p_product_id uuid,
  p_notes text,
  p_workers jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_unit operational_units%rowtype;
  v_order production_orders%rowtype;
  v_bom bom_headers%rowtype;
  v_worker jsonb;
  v_worker_id uuid;
  v_group_id uuid;
  v_regular_hours numeric;
  v_overtime_hours numeric;
  v_attendance_status text;
  v_batch_id uuid;
  v_batch_number text;
  v_bom_id uuid := p_bom_header_id;
  v_product_id uuid := p_product_id;
  v_bom_output_id uuid;
  v_remaining numeric;
  v_worker_count integer;
  v_distinct_worker_count integer;
begin
  if auth.uid() is null then
    raise exception using
      errcode = '42501',
      message = 'Your session has expired. Sign in again before creating a production batch.';
  end if;

  select *
  into v_unit
  from operational_units
  where id = p_operational_unit_id
    and is_active
  for update;

  if not found then
    raise exception 'The selected operational unit is not active or no longer exists.';
  end if;

  if not user_can_manage_operational_unit(p_operational_unit_id) then
    raise exception using
      errcode = '42501',
      message = 'A current warehouse-manager assignment is required to create floor production batches for this warehouse.';
  end if;

  if v_unit.warehouse_id is null then
    raise exception 'The operational unit is not connected to an inventory warehouse.';
  end if;

  if not exists (
    select 1 from warehouses w
    where w.id = v_unit.warehouse_id and w.is_active
  ) then
    raise exception 'The operational unit warehouse is not active.';
  end if;

  if p_warehouse_id is not null and p_warehouse_id is distinct from v_unit.warehouse_id then
    raise exception 'The selected warehouse does not match the operational unit.';
  end if;

  if p_production_date is null then
    raise exception 'Production date is required.';
  end if;

  if p_status is null or p_status not in ('draft', 'submitted') then
    raise exception 'A new production batch must be saved as draft or submitted for approval.';
  end if;

  if p_target_units is null or p_target_units <= 0 then
    raise exception 'Target units must be greater than zero.';
  end if;

  if coalesce(p_actual_units, 0) < 0
    or coalesce(p_rejected_units, 0) < 0
    or coalesce(p_rejected_units, 0) > coalesce(p_actual_units, 0) then
    raise exception 'Rejected units must be between zero and actual units.';
  end if;

  if p_allocation_method is null
    or p_allocation_method not in ('equal', 'hours_weighted', 'manual', 'role_weighted') then
    raise exception 'The selected output allocation method is not valid.';
  end if;

  if not exists (
    select 1
    from operational_task_types t
    where t.id = p_task_type_id
      and t.is_active
      and (
        t.operational_unit_id is null
        or t.operational_unit_id = p_operational_unit_id
      )
  ) then
    raise exception 'The selected task type is not available for this operational unit.';
  end if;

  if p_shift_id is not null and not exists (
    select 1
    from operational_shifts s
    where s.id = p_shift_id
      and s.operational_unit_id = p_operational_unit_id
      and s.is_active
  ) then
    raise exception 'The selected shift does not belong to this operational unit.';
  end if;

  if p_supervisor_employee_id is not null and not exists (
    select 1
    from operational_employee_directory d
    where d.id = p_supervisor_employee_id
      and d.operational_unit_id = p_operational_unit_id
  ) then
    raise exception 'The selected supervisor is not assigned to this warehouse.';
  end if;

  if p_workers is null
    or jsonb_typeof(p_workers) <> 'array'
    or jsonb_array_length(p_workers) = 0 then
    raise exception 'Select at least one worker or workforce group.';
  end if;

  select
    count(*),
    count(distinct worker ->> 'employee_id')
  into v_worker_count, v_distinct_worker_count
  from jsonb_array_elements(p_workers) worker;

  if v_worker_count <> v_distinct_worker_count then
    raise exception 'A worker can only be allocated to a production batch once.';
  end if;

  if p_production_order_id is not null then
    select *
    into v_order
    from production_orders
    where id = p_production_order_id
    for update;

    if not found then
      raise exception 'The linked production order was not found.';
    end if;

    if not (
      v_order.company_id is null
      or user_can_access_company(v_order.company_id)
      or user_can_manage_operational_unit(p_operational_unit_id)
    ) then
      raise exception using
        errcode = '42501',
        message = 'The production order is outside your company scope.';
    end if;

    if v_unit.company_id is not null
      and v_order.company_id is not null
      and v_order.company_id is distinct from v_unit.company_id then
      raise exception 'The production order belongs to another company.';
    end if;

    if v_order.status is null or v_order.status not in ('DRAFT', 'IN_PROGRESS') then
      raise exception 'Only draft or in-progress production orders can be sent to the warehouse floor.';
    end if;

    if v_order.warehouse_id is distinct from v_unit.warehouse_id then
      raise exception 'The production order belongs to a different warehouse.';
    end if;

    if exists (
      select 1
      from production_batches b
      where b.production_order_id = p_production_order_id
        and b.status not in ('approved', 'cancelled')
    ) then
      raise exception 'This production order already has an open warehouse batch. Finish or cancel it before creating another.';
    end if;

    v_remaining := greatest(
      0,
      coalesce(v_order.target_quantity, 0) - coalesce(v_order.completed_quantity, 0)
    );

    if v_remaining <= 0 then
      raise exception 'This production order has no quantity remaining.';
    end if;

    if p_target_units > v_remaining then
      raise exception 'Batch target (%) exceeds the production order quantity remaining (%).',
        p_target_units,
        v_remaining;
    end if;

    if p_bom_header_id is not null
      and v_order.bom_header_id is not null
      and p_bom_header_id is distinct from v_order.bom_header_id then
      raise exception 'The selected BOM does not match the production order.';
    end if;

    if p_product_id is not null
      and v_order.product_id is not null
      and p_product_id is distinct from v_order.product_id then
      raise exception 'The selected product does not match the production order.';
    end if;

    v_bom_id := coalesce(v_order.bom_header_id, p_bom_header_id);
    v_product_id := coalesce(v_order.product_id, p_product_id);

    if v_bom_id is null then
      raise exception 'A linked production order requires an active BOM before it can be sent to the floor.';
    end if;
  end if;

  if p_production_order_id is null
    and (v_bom_id is not null or v_product_id is not null) then
    raise exception 'Create a company-scoped production order before linking a BOM or product to a warehouse batch.';
  end if;

  if v_bom_id is not null then
    select *
    into v_bom
    from bom_headers
    where id = v_bom_id
      and is_active;

    if not found then
      raise exception 'The linked BOM is not active or no longer exists.';
    end if;

    v_bom_output_id := coalesce(v_bom.finished_product_id, v_bom.product_id);
    if v_bom_output_id is null then
      raise exception 'The linked BOM does not identify a finished product.';
    end if;

    if v_product_id is not null and v_product_id is distinct from v_bom_output_id then
      raise exception 'The production order product does not match the BOM finished product.';
    end if;

    v_product_id := v_bom_output_id;
  elsif v_product_id is not null then
    raise exception 'Select an active BOM for inventory-linked production, or leave both BOM and product empty for an operational-only batch.';
  end if;

  v_batch_number :=
    'PB-'
    || to_char(p_production_date, 'YYYYMMDD')
    || '-'
    || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8));

  insert into production_batches (
    batch_number,
    operational_unit_id,
    warehouse_id,
    task_type_id,
    shift_id,
    production_date,
    target_units,
    actual_units,
    rejected_units,
    allocation_method,
    status,
    supervisor_employee_id,
    production_order_id,
    bom_header_id,
    product_id,
    inventory_posting_status,
    entered_by,
    notes
  )
  values (
    v_batch_number,
    p_operational_unit_id,
    v_unit.warehouse_id,
    p_task_type_id,
    p_shift_id,
    p_production_date,
    p_target_units,
    coalesce(p_actual_units, 0),
    coalesce(p_rejected_units, 0),
    p_allocation_method,
    p_status,
    p_supervisor_employee_id,
    p_production_order_id,
    v_bom_id,
    v_product_id,
    case
      when p_production_order_id is not null or v_bom_id is not null then 'pending'
      else 'not_required'
    end,
    auth.uid(),
    nullif(trim(p_notes), '')
  )
  returning id into v_batch_id;

  for v_worker in
    select value
    from jsonb_array_elements(p_workers)
  loop
    begin
      v_worker_id := nullif(v_worker ->> 'employee_id', '')::uuid;
      v_group_id := nullif(v_worker ->> 'source_group_id', '')::uuid;
      v_regular_hours := coalesce(nullif(v_worker ->> 'regular_hours', '')::numeric, 0);
      v_overtime_hours := coalesce(nullif(v_worker ->> 'overtime_hours', '')::numeric, 0);
      v_attendance_status := coalesce(nullif(v_worker ->> 'attendance_status', ''), 'present');
    exception
      when invalid_text_representation then
        raise exception 'One or more worker allocations contain invalid values.';
    end;

    if v_worker_id is null or not exists (
      select 1
      from operational_employee_directory d
      where d.id = v_worker_id
        and d.operational_unit_id = p_operational_unit_id
    ) then
      raise exception 'Every worker must be actively assigned to the selected warehouse.';
    end if;

    if v_regular_hours < 0 or v_regular_hours > 24
      or v_overtime_hours < 0 or v_overtime_hours > 16 then
      raise exception 'Worker hours exceed the allowed regular or overtime range.';
    end if;

    if v_attendance_status not in ('present', 'absent', 'partial', 'leave') then
      raise exception 'A worker allocation contains an invalid attendance status.';
    end if;

    if v_group_id is not null and not exists (
      select 1
      from workforce_groups g
      join workforce_group_members m
        on m.workforce_group_id = g.id
       and m.employee_id = v_worker_id
       and m.is_active
      where g.id = v_group_id
        and g.operational_unit_id = p_operational_unit_id
        and g.is_active
    ) then
      raise exception 'A worker source group does not match the selected warehouse allocation.';
    end if;

    insert into production_batch_workers (
      production_batch_id,
      employee_id,
      source_group_id,
      regular_hours,
      overtime_hours,
      attendance_status
    )
    values (
      v_batch_id,
      v_worker_id,
      v_group_id,
      v_regular_hours,
      v_overtime_hours,
      v_attendance_status
    );
  end loop;

  return v_batch_id;
exception
  when unique_violation then
    if p_production_order_id is not null then
      raise exception 'This production order already has an open warehouse batch. Finish or cancel it before creating another.';
    end if;
    raise;
end;
$$;

create or replace function log_unmanaged_production(
  p_bom_header_id uuid,
  p_warehouse_id uuid,
  p_quantity numeric,
  p_notes text,
  p_log_date date,
  p_employee_id uuid,
  p_production_order_id uuid,
  p_company_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_bom bom_headers%rowtype;
  v_order production_orders%rowtype;
  v_order_found boolean := false;
  v_order_count integer := 0;
  v_product_id uuid;
  v_company_id uuid;
  v_unit_company_id uuid;
  v_unit_company_count integer := 0;
  v_log_id uuid;
  v_line record;
  v_available numeric;
  v_average_cost numeric;
  v_unit_cost numeric := 0;
  v_new_completed numeric;
  v_reference_id text;
  v_reference_type text;
  v_label text;
begin
  if auth.uid() is null then
    raise exception using
      errcode = '42501',
      message = 'Your session has expired. Sign in again before logging production.';
  end if;

  if not has_role(array['manufacturing_sales']) then
    raise exception using
      errcode = '42501',
      message = 'Production access is required to log output.';
  end if;

  if p_quantity is null or p_quantity <= 0 then
    raise exception 'Production quantity must be greater than zero.';
  end if;

  if p_log_date is null then
    raise exception 'Select a production date.';
  end if;

  if not exists (
    select 1
    from warehouses w
    where w.id = p_warehouse_id
      and w.is_active
  ) then
    raise exception 'The selected warehouse is inactive or no longer exists.';
  end if;

  select *
  into v_bom
  from bom_headers
  where id = p_bom_header_id
    and is_active;

  if not found then
    raise exception 'Select an active BOM before logging production.';
  end if;

  v_product_id := coalesce(v_bom.finished_product_id, v_bom.product_id);
  if v_product_id is null then
    raise exception 'The selected BOM does not identify a finished product.';
  end if;

  if p_employee_id is not null
    and not exists (
      select 1
      from employees e
      where e.id = p_employee_id
        and e.is_active
        and e.warehouse_id = p_warehouse_id
    ) then
    raise exception 'The selected worker is not active in this warehouse.';
  end if;

  -- Serialize production and stock movements per physical warehouse.
  perform pg_advisory_xact_lock(
    hashtextextended('warehouse-production:' || p_warehouse_id::text, 0)
  );

  select
    count(distinct ou.company_id),
    min(ou.company_id::text)::uuid
  into v_unit_company_count, v_unit_company_id
  from operational_units ou
  where ou.warehouse_id = p_warehouse_id
    and ou.is_active
    and ou.company_id is not null;

  if p_production_order_id is not null then
    select *
    into v_order
    from production_orders po
    where po.id = p_production_order_id
      and po.bom_header_id = p_bom_header_id
      and po.warehouse_id = p_warehouse_id
      and po.status in ('DRAFT', 'IN_PROGRESS')
      and coalesce(po.completed_quantity, 0) < po.target_quantity
    for update;

    if not found then
      raise exception 'The selected production order is not open for this BOM and warehouse.';
    end if;
    v_order_found := true;
  else
    select count(*)
    into v_order_count
    from production_orders po
    where po.bom_header_id = p_bom_header_id
      and po.warehouse_id = p_warehouse_id
      and po.status in ('DRAFT', 'IN_PROGRESS')
      and coalesce(po.completed_quantity, 0) < po.target_quantity
      and user_can_view_production_order(po.warehouse_id, po.company_id);

    if v_order_count > 1 then
      raise exception 'More than one open production order matches this BOM and warehouse. Select the order in the Production workspace before logging output.';
    elsif v_order_count = 1 then
      select *
      into v_order
      from production_orders po
      where po.bom_header_id = p_bom_header_id
        and po.warehouse_id = p_warehouse_id
        and po.status in ('DRAFT', 'IN_PROGRESS')
        and coalesce(po.completed_quantity, 0) < po.target_quantity
        and user_can_view_production_order(po.warehouse_id, po.company_id)
      for update;
      v_order_found := true;
    end if;
  end if;

  if v_order_found then
    if not user_can_view_production_order(v_order.warehouse_id, v_order.company_id) then
      raise exception using
        errcode = '42501',
        message = 'The open production order is outside your company or warehouse scope.';
    end if;

    if p_company_id is not null
      and v_order.company_id is not null
      and p_company_id is distinct from v_order.company_id then
      raise exception 'The selected company does not match the production order.';
    end if;
    v_company_id := coalesce(v_order.company_id, p_company_id);

    if p_quantity > greatest(
      0,
      v_order.target_quantity - coalesce(v_order.completed_quantity, 0)
    ) then
      raise exception 'Logged output (%) exceeds the % units remaining on production order %.',
        p_quantity,
        greatest(0, v_order.target_quantity - coalesce(v_order.completed_quantity, 0)),
        v_order.order_number;
    end if;
  else
    v_company_id := p_company_id;

    if v_company_id is null and v_unit_company_count = 1 then
      v_company_id := v_unit_company_id;
    end if;

    if v_company_id is not null and not exists (
      select 1
      from companies c
      where c.id = v_company_id
        and c.is_active
        and user_can_access_company(c.id)
    ) then
      raise exception using
        errcode = '42501',
        message = 'The production log company is outside your access scope.';
    end if;

    if v_unit_company_count = 1
      and v_company_id is not null
      and v_unit_company_id is distinct from v_company_id then
      raise exception 'The selected company does not match this warehouse operational unit.';
    end if;
  end if;

  if exists (
    select 1
    from production_batches b
    join operational_units ou on ou.id = b.operational_unit_id
    where b.status <> 'cancelled'
      and (
        (v_order_found and b.production_order_id = v_order.id)
        or (
          ou.warehouse_id = p_warehouse_id
          and b.bom_header_id = p_bom_header_id
          and b.production_date = p_log_date
        )
      )
  ) then
    raise exception 'This production is managed in Warehouse Operations. Record output on its floor batch so inventory and labor post once.';
  end if;

  -- Validate every component before any production or inventory write.
  for v_line in
    select component_product_id, quantity_required
    from bom_lines
    where bom_header_id = p_bom_header_id
  loop
    select coalesce(sum(quantity), 0)
    into v_available
    from inventory_ledger
    where warehouse_id = p_warehouse_id
      and product_id = v_line.component_product_id;

    if v_available < v_line.quantity_required * p_quantity then
      raise exception 'Insufficient component stock: component % has %, requires %.',
        v_line.component_product_id,
        v_available,
        v_line.quantity_required * p_quantity;
    end if;

    select coalesce(
      sum(quantity * unit_cost_etb) / nullif(sum(quantity), 0),
      0
    )
    into v_average_cost
    from inventory_ledger
    where warehouse_id = p_warehouse_id
      and product_id = v_line.component_product_id
      and quantity > 0
      and unit_cost_etb is not null;

    v_unit_cost := v_unit_cost
      + coalesce(v_average_cost, 0) * v_line.quantity_required;
  end loop;

  if v_order_found then
    select l.id
    into v_log_id
    from production_daily_logs l
    where l.production_order_id = v_order.id
      and l.log_date = p_log_date
    order by l.created_at
    limit 1
    for update;

    if found then
      update production_daily_logs
      set
        quantity_produced = quantity_produced + p_quantity,
        notes = coalesce(nullif(trim(p_notes), ''), notes),
        employee_id = coalesce(p_employee_id, employee_id),
        company_id = v_company_id
      where id = v_log_id;
    else
      insert into production_daily_logs(
        production_order_id,
        log_date,
        quantity_produced,
        notes,
        employee_id,
        company_id
      )
      values (
        v_order.id,
        p_log_date,
        p_quantity,
        nullif(trim(p_notes), ''),
        p_employee_id,
        v_company_id
      )
      returning id into v_log_id;
    end if;

    v_new_completed := coalesce(v_order.completed_quantity, 0) + p_quantity;
    update production_orders
    set
      completed_quantity = v_new_completed,
      status = case
        when v_new_completed >= v_order.target_quantity then 'COMPLETED'
        else 'IN_PROGRESS'
      end::production_order_status,
      actual_start_date = coalesce(actual_start_date, p_log_date),
      actual_end_date = case
        when v_new_completed >= v_order.target_quantity then p_log_date
        else actual_end_date
      end,
      updated_at = now()
    where id = v_order.id;

    v_reference_id := v_order.id::text;
    v_reference_type := 'production_order';
    v_label := v_order.order_number;
  else
    select l.id
    into v_log_id
    from production_daily_logs l
    where l.production_order_id is null
      and l.bom_header_id = p_bom_header_id
      and l.warehouse_id = p_warehouse_id
      and l.company_id is not distinct from v_company_id
      and l.log_date = p_log_date
    order by l.created_at
    limit 1
    for update;

    if found then
      update production_daily_logs
      set
        quantity_produced = quantity_produced + p_quantity,
        notes = coalesce(nullif(trim(p_notes), ''), notes),
        employee_id = coalesce(p_employee_id, employee_id),
        company_id = v_company_id
      where id = v_log_id;
    else
      insert into production_daily_logs(
        production_order_id,
        bom_header_id,
        product_id,
        warehouse_id,
        log_date,
        quantity_produced,
        notes,
        employee_id,
        company_id
      )
      values (
        null,
        p_bom_header_id,
        v_product_id,
        p_warehouse_id,
        p_log_date,
        p_quantity,
        nullif(trim(p_notes), ''),
        p_employee_id,
        v_company_id
      )
      returning id into v_log_id;
    end if;

    v_reference_id := v_log_id::text;
    v_reference_type := 'production_log';
    v_label := coalesce(v_bom.name, 'Production') || ' (' || p_log_date::text || ')';
  end if;

  for v_line in
    select component_product_id, quantity_required
    from bom_lines
    where bom_header_id = p_bom_header_id
  loop
    insert into inventory_ledger(
      warehouse_id,
      product_id,
      movement_type,
      quantity,
      unit_cost_etb,
      movement_date,
      reference_id,
      reference_type,
      notes
    )
    values (
      p_warehouse_id,
      v_line.component_product_id,
      'PRODUCTION_CONSUMED',
      -1 * (v_line.quantity_required * p_quantity),
      null,
      p_log_date,
      v_reference_id,
      v_reference_type,
      'Consumed for ' || v_label
    );
  end loop;

  insert into inventory_ledger(
    warehouse_id,
    product_id,
    movement_type,
    quantity,
    unit_cost_etb,
    movement_date,
    reference_id,
    reference_type,
    notes
  )
  values (
    p_warehouse_id,
    v_product_id,
    'PRODUCTION_OUTPUT',
    p_quantity,
    v_unit_cost,
    p_log_date,
    v_reference_id,
    v_reference_type,
    'Production output · ' || v_label
  );

  if to_regclass('public.current_inventory') is not null then
    execute 'refresh materialized view public.current_inventory';
  end if;

  return v_log_id;
end;
$$;
