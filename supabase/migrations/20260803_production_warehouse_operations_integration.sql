-- Production planning + Warehouse Operations integration
-- ------------------------------------------------------
-- Production orders/BOMs remain the material-planning source of truth.
-- Operational batches remain the labor/attendance/efficiency source of truth.
-- A linked operational batch posts its accepted output to the production log
-- and inventory ledger exactly once, only when the batch is approved.

alter table production_orders add column if not exists warehouse_id uuid references warehouses(id);
alter table production_orders add column if not exists actual_start_date date;
alter table production_orders add column if not exists actual_end_date date;
alter table production_orders add column if not exists notes text;

alter table bom_headers add column if not exists finished_product_id uuid references products(id);

alter table production_daily_logs add column if not exists operational_unit_id uuid references operational_units(id);
alter table production_daily_logs add column if not exists bom_header_id uuid references bom_headers(id);
alter table production_daily_logs add column if not exists product_id uuid references products(id);
alter table production_daily_logs add column if not exists warehouse_id uuid references warehouses(id);
alter table production_daily_logs alter column production_order_id drop not null;

alter table production_batches add column if not exists production_order_id uuid references production_orders(id) on delete set null;
alter table production_batches add column if not exists bom_header_id uuid references bom_headers(id) on delete set null;
alter table production_batches add column if not exists product_id uuid references products(id) on delete set null;
alter table production_batches add column if not exists production_daily_log_id uuid references production_daily_logs(id) on delete set null;
alter table production_batches add column if not exists inventory_posting_status text not null default 'not_required';
alter table production_batches add column if not exists inventory_posted_at timestamptz;

alter table production_batches drop constraint if exists production_batches_inventory_posting_status_check;
alter table production_batches add constraint production_batches_inventory_posting_status_check
  check (inventory_posting_status in ('not_required','pending','posted','failed'));

create index if not exists idx_production_batches_order
  on production_batches(production_order_id, production_date desc)
  where production_order_id is not null;
create unique index if not exists uq_production_batches_open_order
  on production_batches(production_order_id)
  where production_order_id is not null and status not in ('approved','cancelled');
create index if not exists idx_production_batches_bom
  on production_batches(bom_header_id, operational_unit_id, production_date desc)
  where bom_header_id is not null;
create index if not exists idx_production_batches_inventory_posting
  on production_batches(inventory_posting_status, production_date desc)
  where inventory_posting_status in ('pending','failed');

insert into operational_task_types(operational_unit_id,name,code,standard_units_per_hour,incentive_eligible)
select seed.operational_unit_id,seed.name,seed.code,seed.standard_units_per_hour,seed.incentive_eligible
from (
  values
    (null::uuid,'Sticker application','STICKER',80::numeric,true),
    (null::uuid,'Other production','OTHER',50::numeric,true)
) as seed(operational_unit_id,name,code,standard_units_per_hour,incentive_eligible)
where not exists (
  select 1 from operational_task_types t
  where t.operational_unit_id is null and t.code=seed.code
);

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
      new.production_date,new.id::text,'production_batch',
      'Consumed for '||new.batch_number||' · '||v_product.name
    );
  end loop;

  insert into inventory_ledger(
    warehouse_id,product_id,movement_type,quantity,unit_cost_etb,
    movement_date,reference_id,reference_type,notes
  ) values (
    v_unit.warehouse_id,v_product.id,'PRODUCTION_OUTPUT',v_accepted,v_unit_cost,
    new.production_date,new.id::text,'production_batch',
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

drop trigger if exists trg_post_approved_operational_batch on production_batches;
create trigger trg_post_approved_operational_batch
after update of status on production_batches
for each row
when (new.status='approved' and old.status is distinct from new.status)
execute function post_approved_operational_batch_to_inventory();

create or replace function sync_production_order_from_operational_batch()
returns trigger
language plpgsql
security definer
set search_path=public
as $$
begin
  if new.production_order_id is null then return new; end if;
  if (
    (tg_op='INSERT' and new.status in ('active','completed','submitted'))
    or
    (tg_op='UPDATE' and new.status in ('active','completed','submitted') and old.status is distinct from new.status)
  ) then
    update production_orders
    set
      status='IN_PROGRESS',
      actual_start_date=coalesce(actual_start_date,new.production_date),
      updated_at=now()
    where id=new.production_order_id and status in ('DRAFT','IN_PROGRESS');
  elsif tg_op='UPDATE' and new.status='cancelled' and old.status is distinct from new.status then
    if not exists (
      select 1 from production_batches b
      where b.production_order_id=new.production_order_id
        and b.id<>new.id
        and b.status in ('active','submitted')
    ) then
      if coalesce((select completed_quantity from production_orders where id=new.production_order_id),0)>0 then
        update production_orders
        set status='IN_PROGRESS',updated_at=now()
        where id=new.production_order_id and status<>'COMPLETED';
      else
        update production_orders
        set status='DRAFT',updated_at=now()
        where id=new.production_order_id and status<>'COMPLETED';
      end if;
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_sync_production_order_from_operational_batch on production_batches;
create trigger trg_sync_production_order_from_operational_batch
after insert or update on production_batches
for each row
execute function sync_production_order_from_operational_batch();

revoke all on function post_approved_operational_batch_to_inventory() from public;
revoke all on function sync_production_order_from_operational_batch() from public;
