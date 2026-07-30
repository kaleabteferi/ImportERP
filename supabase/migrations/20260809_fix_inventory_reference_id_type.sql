-- inventory_ledger.reference_id is uuid, but two functions cast the batch/
-- order/log id to text before inserting, which Postgres refuses ("column
-- reference_id is of type uuid but expression is of type text"). This broke
-- every batch approval that posts inventory. Insert the uuid directly.

create or replace function post_approved_operational_batch_to_inventory()
returns trigger
language plpgsql
security definer
set search_path=public
as $$
declare
  v_unit operational_units%rowtype;
  v_order production_orders%rowtype;
  v_bom bom_headers%rowtype;
  v_product products%rowtype;
  v_line record;
  v_available numeric;
  v_average_cost numeric;
  v_unit_cost numeric := 0;
  v_accepted numeric;
  v_log_id uuid;
  v_new_completed numeric;
begin
  if new.status<>'approved' or old.status='approved' then return new; end if;
  if new.production_order_id is null and new.bom_header_id is null and new.product_id is null then
    update production_batches
    set inventory_posting_status='not_required'
    where id=new.id and inventory_posting_status<>'not_required';
    return new;
  end if;
  if new.inventory_posting_status='posted' then return new; end if;

  select * into v_unit from operational_units where id=new.operational_unit_id;
  if not found or v_unit.warehouse_id is null then
    raise exception 'The operational unit is not connected to an inventory warehouse';
  end if;
  if new.warehouse_id is not null and new.warehouse_id is distinct from v_unit.warehouse_id then
    raise exception 'The production batch and operational unit belong to different warehouses';
  end if;

  -- Serialize inventory postings per warehouse. This prevents two approvals
  -- that share a component from both passing the stock check concurrently.
  perform pg_advisory_xact_lock(
    hashtextextended('warehouse-production:'||v_unit.warehouse_id::text,0)
  );

  if new.production_order_id is not null then
    select * into v_order from production_orders where id=new.production_order_id for update;
    if not found then raise exception 'Linked production order was not found'; end if;
    if v_order.warehouse_id is distinct from v_unit.warehouse_id then
      raise exception 'Production order and operational batch belong to different warehouses';
    end if;
    if new.bom_header_id is not null and v_order.bom_header_id is not null
      and new.bom_header_id is distinct from v_order.bom_header_id then
      raise exception 'Production batch BOM does not match the linked production order';
    end if;
    if new.product_id is not null and v_order.product_id is not null
      and new.product_id is distinct from v_order.product_id then
      raise exception 'Production batch product does not match the linked production order';
    end if;
  end if;

  select * into v_bom
  from bom_headers
  where id=coalesce(new.bom_header_id,v_order.bom_header_id);
  if not found then raise exception 'A linked production batch requires a valid BOM'; end if;

  select * into v_product
  from products
  where id=coalesce(new.product_id,v_order.product_id,v_bom.product_id,v_bom.finished_product_id);
  if not found then raise exception 'A linked production batch requires a valid finished product'; end if;

  v_accepted := greatest(0,new.actual_units-new.rejected_units);
  if new.production_order_id is not null
    and v_accepted > greatest(0,v_order.target_quantity-coalesce(v_order.completed_quantity,0)) then
    raise exception 'Accepted output for batch % exceeds the % units remaining on production order %',
      new.batch_number,
      greatest(0,v_order.target_quantity-coalesce(v_order.completed_quantity,0)),
      v_order.order_number;
  end if;
  if v_accepted=0 then
    update production_batches
    set
      inventory_posting_status='posted',
      inventory_posted_at=now(),
      product_id=v_product.id,
      bom_header_id=v_bom.id
    where id=new.id;
    return new;
  end if;

  -- Validate all components before any inventory or production-log write.
  for v_line in
    select component_product_id,quantity_required
    from bom_lines where bom_header_id=v_bom.id
  loop
    select coalesce(sum(quantity),0) into v_available
    from inventory_ledger
    where warehouse_id=v_unit.warehouse_id and product_id=v_line.component_product_id;
    if v_available < v_line.quantity_required*v_accepted then
      raise exception 'Insufficient component stock for approved batch %: component % has %, requires %',
        new.batch_number,v_line.component_product_id,v_available,v_line.quantity_required*v_accepted;
    end if;

    select coalesce(
      sum(quantity*unit_cost_etb)/nullif(sum(quantity),0),
      0
    ) into v_average_cost
    from inventory_ledger
    where warehouse_id=v_unit.warehouse_id
      and product_id=v_line.component_product_id
      and quantity>0 and unit_cost_etb is not null;
    v_unit_cost := v_unit_cost + coalesce(v_average_cost,0)*v_line.quantity_required;
  end loop;

  -- Aggregate operational batches into the existing daily production log.
  if new.production_order_id is not null then
    select id into v_log_id
    from production_daily_logs
    where production_order_id=new.production_order_id and log_date=new.production_date
    order by created_at
    limit 1
    for update;

    if found then
      update production_daily_logs
      set
        quantity_produced=quantity_produced+v_accepted,
        operational_unit_id=new.operational_unit_id,
        notes=concat_ws(E'\n',notes,'Warehouse batch '||new.batch_number||' approved')
      where id=v_log_id;
    else
      insert into production_daily_logs(
        production_order_id,log_date,quantity_produced,notes,operational_unit_id
      ) values (
        new.production_order_id,new.production_date,v_accepted,
        'Warehouse batch '||new.batch_number||' approved',new.operational_unit_id
      ) returning id into v_log_id;
    end if;

    v_new_completed := least(
      v_order.target_quantity,
      greatest(0,coalesce(v_order.completed_quantity,0)+v_accepted)
    );
    if v_new_completed>=v_order.target_quantity then
      update production_orders
      set
        completed_quantity=v_new_completed,
        status='COMPLETED',
        actual_start_date=coalesce(actual_start_date,new.production_date),
        actual_end_date=new.production_date,
        updated_at=now()
      where id=v_order.id;
    else
      update production_orders
      set
        completed_quantity=v_new_completed,
        status='IN_PROGRESS',
        actual_start_date=coalesce(actual_start_date,new.production_date),
        updated_at=now()
      where id=v_order.id;
    end if;
  else
    select id into v_log_id
    from production_daily_logs
    where production_order_id is null
      and bom_header_id=v_bom.id
      and warehouse_id=v_unit.warehouse_id
      and log_date=new.production_date
    order by created_at
    limit 1
    for update;

    if found then
      update production_daily_logs
      set
        quantity_produced=quantity_produced+v_accepted,
        operational_unit_id=new.operational_unit_id,
        notes=concat_ws(E'\n',notes,'Warehouse batch '||new.batch_number||' approved')
      where id=v_log_id;
    else
      insert into production_daily_logs(
        production_order_id,bom_header_id,product_id,warehouse_id,
        log_date,quantity_produced,notes,operational_unit_id
      ) values (
        null,v_bom.id,v_product.id,v_unit.warehouse_id,
        new.production_date,v_accepted,
        'Warehouse batch '||new.batch_number||' approved',new.operational_unit_id
      ) returning id into v_log_id;
    end if;
  end if;

  for v_line in
    select component_product_id,quantity_required
    from bom_lines where bom_header_id=v_bom.id
  loop
    insert into inventory_ledger(
      warehouse_id,product_id,movement_type,quantity,unit_cost_etb,
      movement_date,reference_id,reference_type,notes
    ) values (
      v_unit.warehouse_id,v_line.component_product_id,'PRODUCTION_CONSUMED',
      -1*(v_line.quantity_required*v_accepted),null,
      new.production_date,new.id,'production_batch',
      'Consumed for '||new.batch_number||' · '||v_product.name
    );
  end loop;

  insert into inventory_ledger(
    warehouse_id,product_id,movement_type,quantity,unit_cost_etb,
    movement_date,reference_id,reference_type,notes
  ) values (
    v_unit.warehouse_id,v_product.id,'PRODUCTION_OUTPUT',v_accepted,v_unit_cost,
    new.production_date,new.id,'production_batch',
    'Accepted output · '||new.batch_number
  );

  update production_batches
  set
    production_daily_log_id=v_log_id,
    product_id=v_product.id,
    bom_header_id=v_bom.id,
    inventory_posting_status='posted',
    inventory_posted_at=now()
  where id=new.id;

  if to_regclass('public.current_inventory') is not null then
    execute 'refresh materialized view public.current_inventory';
  end if;
  return new;
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
  v_reference_id uuid;
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

    v_reference_id := v_order.id;
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

    v_reference_id := v_log_id;
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
