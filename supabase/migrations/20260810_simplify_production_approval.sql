-- Simplify inventory posting: drop the separate "approver" role requirement
-- and the manual approve click. Whoever has warehouse-manage access can now
-- finalize their own submitted results, and finalization happens
-- automatically the moment results are submitted (not as a second step).
-- Stock/quantity/attendance validation still runs — only the extra human
-- approval gate is removed.

create or replace function approve_production_batch(p_batch_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_batch production_batches%rowtype;
  v_total_hours numeric;
  v_present_count integer;
  v_total_weight numeric;
begin
  select * into v_batch from production_batches where id = p_batch_id for update;
  if not found then raise exception 'Production batch not found'; end if;
  if not user_can_manage_operational_unit(v_batch.operational_unit_id) then
    raise exception 'You are not allowed to finalize production for this operational unit';
  end if;
  if v_batch.status not in ('completed','submitted') then
    raise exception 'Only completed or submitted batches can be approved';
  end if;

  select
    coalesce(sum(regular_hours + overtime_hours) filter (where attendance_status in ('present','partial')),0),
    count(*) filter (where attendance_status in ('present','partial')),
    coalesce(sum(allocation_weight) filter (where attendance_status in ('present','partial')),0)
  into v_total_hours, v_present_count, v_total_weight
  from production_batch_workers where production_batch_id = p_batch_id;

  if v_present_count = 0 then raise exception 'Add at least one present worker before approval'; end if;

  update production_batch_workers w
  set units_attributed = case v_batch.allocation_method
    when 'equal' then (v_batch.actual_units - v_batch.rejected_units) / v_present_count
    when 'hours_weighted' then
      case when v_total_hours > 0 then (v_batch.actual_units - v_batch.rejected_units) * (w.regular_hours + w.overtime_hours) / v_total_hours else 0 end
    when 'role_weighted' then
      case when v_total_weight > 0 then (v_batch.actual_units - v_batch.rejected_units) * w.allocation_weight / v_total_weight else 0 end
    else coalesce(w.units_attributed,0)
  end
  where w.production_batch_id = p_batch_id and w.attendance_status in ('present','partial');

  update production_batch_workers w
  set employee_efficiency_pct = round(
    case
      when (w.regular_hours + w.overtime_hours) <= 0 then 0
      when t.standard_units_per_hour is not null and t.standard_units_per_hour > 0
        then coalesce(w.units_attributed,0) / (t.standard_units_per_hour * (w.regular_hours + w.overtime_hours)) * 100
      when v_batch.target_units is not null and v_batch.target_units > 0
        then coalesce(w.units_attributed,0) / (v_batch.target_units / v_present_count) * 100
      else 0
    end, 2
  )
  from operational_task_types t
  where w.production_batch_id = p_batch_id and t.id = v_batch.task_type_id;

  update production_batches
  set status='approved', approved_by=auth.uid(), approved_at=now(), completed_at=coalesce(completed_at,now()), updated_at=now()
  where id=p_batch_id;

  insert into employee_daily_efficiency(
    employee_id, operational_unit_id, log_date, regular_hours, overtime_hours,
    earned_hours, attributed_units, efficiency_pct, rolling_avg_7d, trend_flag,
    needs_attention, calculated_at
  )
  select
    w.employee_id,
    b.operational_unit_id,
    b.production_date,
    sum(w.regular_hours),
    sum(w.overtime_hours),
    sum((w.regular_hours+w.overtime_hours) * coalesce(w.employee_efficiency_pct,0) / 100),
    sum(coalesce(w.units_attributed,0)),
    case when sum(w.regular_hours+w.overtime_hours)>0
      then round(sum(coalesce(w.employee_efficiency_pct,0)*(w.regular_hours+w.overtime_hours))/sum(w.regular_hours+w.overtime_hours),2)
      else 0 end,
    0,
    'stable',
    false,
    now()
  from production_batch_workers w
  join production_batches b on b.id=w.production_batch_id
  where b.operational_unit_id=v_batch.operational_unit_id
    and b.production_date=v_batch.production_date
    and b.status='approved'
    and w.attendance_status in ('present','partial')
  group by w.employee_id,b.operational_unit_id,b.production_date
  on conflict(employee_id,operational_unit_id,log_date) do update set
    regular_hours=excluded.regular_hours,
    overtime_hours=excluded.overtime_hours,
    earned_hours=excluded.earned_hours,
    attributed_units=excluded.attributed_units,
    efficiency_pct=excluded.efficiency_pct,
    calculated_at=now();

  update employee_daily_efficiency e
  set
    rolling_avg_7d = r.avg_eff,
    trend_flag = case when r.avg_eff > e.efficiency_pct + 2 then 'declining' when r.avg_eff + 2 < e.efficiency_pct then 'improving' else 'stable' end,
    needs_attention =
      e.efficiency_pct < 80
      or (r.avg_eff > e.efficiency_pct + 5)
      or coalesce((
        select
          count(*) = 3
          and count(*) filter (where recent.previous_efficiency is not null and recent.efficiency_pct < recent.previous_efficiency) = 2
        from (
          select
            x.efficiency_pct,
            lag(x.efficiency_pct) over(order by x.log_date) as previous_efficiency
          from employee_daily_efficiency x
          where x.employee_id = e.employee_id
            and x.operational_unit_id = e.operational_unit_id
            and x.log_date between v_batch.production_date - 2 and v_batch.production_date
        ) recent
      ), false)
  from (
    select employee_id, operational_unit_id, round(avg(efficiency_pct),2) avg_eff
    from employee_daily_efficiency
    where operational_unit_id=v_batch.operational_unit_id
      and log_date between v_batch.production_date-6 and v_batch.production_date
    group by employee_id,operational_unit_id
  ) r
  where e.employee_id=r.employee_id and e.operational_unit_id=r.operational_unit_id and e.log_date=v_batch.production_date;

  insert into operational_unit_daily_rollups(
    operational_unit_id,log_date,employee_count,total_units,accepted_units,rejected_units,
    regular_hours,overtime_hours,avg_efficiency_pct,output_per_labor_hour,target_achievement_pct,calculated_at
  )
  select
    v_batch.operational_unit_id,
    v_batch.production_date,
    coalesce((select count(distinct w.employee_id) from production_batch_workers w join production_batches b on b.id=w.production_batch_id where b.operational_unit_id=v_batch.operational_unit_id and b.production_date=v_batch.production_date and b.status='approved' and w.attendance_status in ('present','partial')),0),
    coalesce((select sum(actual_units) from production_batches where operational_unit_id=v_batch.operational_unit_id and production_date=v_batch.production_date and status='approved'),0),
    coalesce((select sum(actual_units-rejected_units) from production_batches where operational_unit_id=v_batch.operational_unit_id and production_date=v_batch.production_date and status='approved'),0),
    coalesce((select sum(rejected_units) from production_batches where operational_unit_id=v_batch.operational_unit_id and production_date=v_batch.production_date and status='approved'),0),
    coalesce((select sum(w.regular_hours) from production_batch_workers w join production_batches b on b.id=w.production_batch_id where b.operational_unit_id=v_batch.operational_unit_id and b.production_date=v_batch.production_date and b.status='approved'),0),
    coalesce((select sum(w.overtime_hours) from production_batch_workers w join production_batches b on b.id=w.production_batch_id where b.operational_unit_id=v_batch.operational_unit_id and b.production_date=v_batch.production_date and b.status='approved'),0),
    coalesce((select sum(e.efficiency_pct*(e.regular_hours+e.overtime_hours))/nullif(sum(e.regular_hours+e.overtime_hours),0) from employee_daily_efficiency e where e.operational_unit_id=v_batch.operational_unit_id and e.log_date=v_batch.production_date),0),
    coalesce(
      coalesce((select sum(actual_units-rejected_units) from production_batches where operational_unit_id=v_batch.operational_unit_id and production_date=v_batch.production_date and status='approved'),0)
        / nullif(coalesce((select sum(w.regular_hours+w.overtime_hours) from production_batch_workers w join production_batches b on b.id=w.production_batch_id where b.operational_unit_id=v_batch.operational_unit_id and b.production_date=v_batch.production_date and b.status='approved'),0),0),
      0
    ),
    coalesce((select sum(actual_units-rejected_units)/nullif(sum(target_units),0)*100 from production_batches where operational_unit_id=v_batch.operational_unit_id and production_date=v_batch.production_date and status='approved'),0),
    now()
  on conflict(operational_unit_id,log_date) do update set
    employee_count=excluded.employee_count,total_units=excluded.total_units,accepted_units=excluded.accepted_units,
    rejected_units=excluded.rejected_units,regular_hours=excluded.regular_hours,overtime_hours=excluded.overtime_hours,
    avg_efficiency_pct=excluded.avg_efficiency_pct,output_per_labor_hour=excluded.output_per_labor_hour,
    target_achievement_pct=excluded.target_achievement_pct,calculated_at=now();

  with ranked as (
    select id,row_number() over(order by avg_efficiency_pct desc) r
    from operational_unit_daily_rollups where log_date=v_batch.production_date
  )
  update operational_unit_daily_rollups u set rank_position=ranked.r from ranked where u.id=ranked.id;
end;
$$;

create or replace function transition_production_batch(
  p_batch_id uuid,
  p_action text,
  p_actual_units numeric default null,
  p_rejected_units numeric default null,
  p_notes text default null,
  p_worker_updates jsonb default '[]'::jsonb
)
returns void
language plpgsql
security definer
set search_path=public
as $$
declare
  v_batch production_batches%rowtype;
  v_worker jsonb;
  v_actual numeric;
  v_rejected numeric;
begin
  select * into v_batch from production_batches where id=p_batch_id for update;
  if not found then raise exception 'Production batch not found'; end if;
  if not user_can_manage_operational_unit(v_batch.operational_unit_id) then
    raise exception 'Only the assigned warehouse manager can change this production batch';
  end if;
  if v_batch.status in ('approved','cancelled') then
    raise exception 'Approved or cancelled production batches are locked';
  end if;

  if p_action='start' then
    if v_batch.status<>'draft' then raise exception 'Only a draft batch can be started'; end if;
    update production_batches
    set status='active',started_at=coalesce(started_at,now()),updated_at=now()
    where id=p_batch_id;
  elsif p_action='submit' then
    if v_batch.status not in ('draft','active','completed','submitted') then
      raise exception 'This production batch cannot be submitted';
    end if;
    if not exists (
      select 1 from production_batch_workers where production_batch_id=p_batch_id
    ) then
      raise exception 'Assign at least one worker before submitting production';
    end if;

    v_actual := coalesce(p_actual_units,v_batch.actual_units);
    v_rejected := coalesce(p_rejected_units,v_batch.rejected_units);
    if v_actual < 0 then raise exception 'Actual units cannot be negative'; end if;
    if v_rejected < 0 or v_rejected > v_actual then
      raise exception 'Rejected units must be between zero and actual units';
    end if;

    for v_worker in
      select value from jsonb_array_elements(coalesce(p_worker_updates,'[]'::jsonb))
    loop
      if coalesce((v_worker->>'regular_hours')::numeric,0) < 0
        or coalesce((v_worker->>'regular_hours')::numeric,0) > 24 then
        raise exception 'Worker regular hours must be between zero and 24';
      end if;
      if coalesce((v_worker->>'overtime_hours')::numeric,0) < 0
        or coalesce((v_worker->>'overtime_hours')::numeric,0) > 16 then
        raise exception 'Worker overtime hours must be between zero and 16';
      end if;
      if coalesce(v_worker->>'attendance_status','') not in ('present','absent','partial','leave') then
        raise exception 'Worker attendance status is invalid';
      end if;

      update production_batch_workers
      set
        regular_hours=coalesce((v_worker->>'regular_hours')::numeric,regular_hours),
        overtime_hours=coalesce((v_worker->>'overtime_hours')::numeric,overtime_hours),
        attendance_status=coalesce(v_worker->>'attendance_status',attendance_status)
      where id=(v_worker->>'id')::uuid and production_batch_id=p_batch_id;
      if not found then raise exception 'A worker update does not belong to this batch'; end if;
    end loop;

    update production_batches
    set
      actual_units=v_actual,
      rejected_units=v_rejected,
      notes=coalesce(p_notes,notes),
      status='submitted',
      started_at=coalesce(started_at,now()),
      completed_at=coalesce(completed_at,now()),
      updated_at=now()
    where id=p_batch_id;

    perform approve_production_batch(p_batch_id);
  elsif p_action='cancel' then
    update production_batches
    set status='cancelled',notes=coalesce(p_notes,notes),updated_at=now()
    where id=p_batch_id;
  else
    raise exception 'Unknown production batch action';
  end if;
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

  if p_status = 'submitted' then
    perform approve_production_batch(v_batch_id);
  end if;

  return v_batch_id;
exception
  when unique_violation then
    if p_production_order_id is not null then
      raise exception 'This production order already has an open warehouse batch. Finish or cancel it before creating another.';
    end if;
    raise;
end;
$$;
