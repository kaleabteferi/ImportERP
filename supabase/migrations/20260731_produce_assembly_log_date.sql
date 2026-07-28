-- Production and Assembly both log ASSEMBLY-stage BOM output, but through
-- two different, redundant code paths: Assembly.tsx calls this atomic RPC
-- (single DB transaction, safe under concurrent submits); Production.tsx's
-- own "Log production" does the same steps (find-or-reuse open order,
-- upsert today's daily log, update completed_quantity, post PRODUCTION_OUTPUT,
-- consume BOM components) by hand across several sequential client-side
-- calls -- for ASSEMBLY-stage rows specifically, that's slower and not
-- atomic. Merging: Production's log-entry flow now calls this same RPC for
-- ASSEMBLY-stage BOMs instead of duplicating the steps itself.
--
-- The one gap blocking that merge: this function always logged against
-- CURRENT_DATE, but Production's modal lets the user pick a log date
-- (to backfill a missed day) -- add p_log_date, defaulting to today so
-- Assembly.tsx's existing (dateless) calls are unaffected.
create or replace function public.produce_assembly(
  p_warehouse_id uuid,
  p_finished_product_id uuid,
  p_quantity numeric,
  p_logged_by uuid default null::uuid,
  p_notes text default null::text,
  p_log_date date default current_date
)
returns jsonb
language plpgsql
as $function$
declare
  v_bom_header_id    uuid;
  v_order_number     text;
  v_order_id         uuid;
  v_bom_line         record;
  v_available        numeric;
  v_avg_cost         numeric;
  v_total_unit_cost  numeric := 0;
  v_product          products%rowtype;
  v_existing_order   record;
  v_new_completed    numeric;
  v_existing_log_id  uuid;
begin
  if p_quantity is null or p_quantity <= 0 then
    raise exception 'Quantity must be greater than 0';
  end if;

  select * into v_product from products where id = p_finished_product_id;
  if not found then
    raise exception 'Product % not found', p_finished_product_id;
  end if;

  select id into v_bom_header_id from bom_headers
    where (finished_product_id = p_finished_product_id or product_id = p_finished_product_id)
      and is_active = true
      and stage = 'ASSEMBLY'
    order by created_at desc
    limit 1;

  if v_bom_header_id is null then
    raise exception 'No active assembly BOM found for "%"', v_product.name;
  end if;

  for v_bom_line in
    select component_product_id, quantity_required from bom_lines where bom_header_id = v_bom_header_id
  loop
    select coalesce(sum(quantity), 0) into v_available
      from inventory_ledger
      where product_id = v_bom_line.component_product_id and warehouse_id = p_warehouse_id;

    if v_available < v_bom_line.quantity_required * p_quantity then
      raise exception 'Not enough stock of component % at this warehouse: have %, need %',
        v_bom_line.component_product_id, v_available, v_bom_line.quantity_required * p_quantity;
    end if;

    select coalesce(sum(quantity * unit_cost_etb) / nullif(sum(quantity), 0), 0) into v_avg_cost
      from inventory_ledger
      where product_id = v_bom_line.component_product_id
        and warehouse_id = p_warehouse_id
        and quantity > 0
        and unit_cost_etb is not null;

    v_total_unit_cost := v_total_unit_cost + (coalesce(v_avg_cost, 0) * v_bom_line.quantity_required);
  end loop;

  -- Prefer whichever order already has a log for this exact day (regardless
  -- of status) -- a from-scratch run marks its order COMPLETED immediately,
  -- so a second same-day call for the same bom+warehouse must still find
  -- and accumulate into that same log row, not fragment into a second
  -- order + a second log row for the same day. Falls back to any other
  -- open order, else this call creates a fresh one.
  select po.id, po.order_number, po.target_quantity, po.completed_quantity into v_existing_order
    from production_daily_logs pdl
    join production_orders po on po.id = pdl.production_order_id
    where po.bom_header_id = v_bom_header_id and po.warehouse_id = p_warehouse_id
      and pdl.log_date = p_log_date
    limit 1;

  if not found then
    select id, order_number, target_quantity, completed_quantity into v_existing_order
      from production_orders
      where bom_header_id = v_bom_header_id and warehouse_id = p_warehouse_id
        and status in ('DRAFT', 'IN_PROGRESS')
      order by created_at
      limit 1;
  end if;

  if found then
    v_order_id := v_existing_order.id;
    v_order_number := v_existing_order.order_number;
    v_new_completed := least(v_existing_order.target_quantity, v_existing_order.completed_quantity + p_quantity);
    -- Explicit cast: Postgres doesn't implicitly coerce a CASE expression's
    -- inferred `text` type to a custom enum column in an UPDATE ... SET --
    -- this was silently never exercised until an existing order (of either
    -- status) could actually be found and reused, since production_orders
    -- inserts elsewhere always set status via an explicit VALUES literal
    -- (which casts fine), never via this text-producing CASE expression.
    update production_orders set
      completed_quantity = v_new_completed,
      status = (case when v_new_completed >= target_quantity then 'COMPLETED' else 'IN_PROGRESS' end)::production_order_status
    where id = v_order_id;

    select id into v_existing_log_id from production_daily_logs
      where production_order_id = v_order_id and log_date = p_log_date;
    if found then
      update production_daily_logs set quantity_produced = quantity_produced + p_quantity where id = v_existing_log_id;
    else
      insert into production_daily_logs (production_order_id, log_date, quantity_produced, notes, logged_by)
      values (v_order_id, p_log_date, p_quantity, p_notes, p_logged_by);
    end if;
  else
    v_order_number := 'PROD-' || to_char(now(), 'YYYYMMDD-HH24MISS');

    insert into production_orders (
      order_number, bom_header_id, warehouse_id, target_quantity, completed_quantity,
      status, product_id, planned_start_date, actual_start_date, actual_end_date, notes
    ) values (
      v_order_number, v_bom_header_id, p_warehouse_id, p_quantity, p_quantity,
      'COMPLETED', p_finished_product_id, p_log_date, p_log_date, p_log_date, p_notes
    ) returning id into v_order_id;

    insert into production_daily_logs (production_order_id, log_date, quantity_produced, notes, logged_by)
    values (v_order_id, p_log_date, p_quantity, p_notes, p_logged_by);
  end if;

  for v_bom_line in
    select component_product_id, quantity_required from bom_lines where bom_header_id = v_bom_header_id
  loop
    insert into inventory_ledger (
      warehouse_id, product_id, movement_type, quantity, unit_cost_etb,
      reference_id, reference_type, notes, movement_date
    ) values (
      p_warehouse_id, v_bom_line.component_product_id, 'PRODUCTION_CONSUMED',
      -1 * (v_bom_line.quantity_required * p_quantity), null,
      v_order_id, 'production_order',
      'Consumed to assemble ' || p_quantity || ' x "' || v_product.name || '"', p_log_date
    );
  end loop;

  insert into inventory_ledger (
    warehouse_id, product_id, movement_type, quantity, unit_cost_etb,
    reference_id, reference_type, notes, movement_date
  ) values (
    p_warehouse_id, p_finished_product_id, 'PRODUCTION_OUTPUT', p_quantity, v_total_unit_cost,
    v_order_id, 'production_order',
    'Assembled ' || p_log_date || ' · order ' || v_order_number, p_log_date
  );

  refresh materialized view concurrently current_inventory;

  return jsonb_build_object(
    'success', true, 'production_order_id', v_order_id,
    'order_number', v_order_number, 'unit_cost_etb', v_total_unit_cost
  );
end;
$function$;
