-- Fix two real bugs in produce_assembly (the Assembly page's RPC) that
-- make it inconsistent with Production.tsx's own "Assembly" stage tab,
-- even though both do the same job (turn CKD/SKD components into finished
-- goods) for the same BOMs:
--   1. It picked an active BOM for the product with no `stage` filter and
--      no deterministic ordering (`LIMIT 1` on an unordered query). Every
--      product only has one active BOM today, so this happens to work, but
--      the moment a product gets a second active BOM (e.g. a STICKER-stage
--      one after assembly), which BOM gets used becomes arbitrary.
--   2. It always INSERTed a brand-new production_orders row, even when an
--      open (DRAFT/IN_PROGRESS) order for that BOM+warehouse already
--      exists. Production.tsx's manual daily-log flow correctly attaches to
--      an existing open order first — produce_assembly didn't, so logging
--      some of a product's run through Production and some through Assembly
--      silently fragments it into two disconnected orders instead of one,
--      understating the original order's progress.
create or replace function produce_assembly(
  p_warehouse_id uuid,
  p_finished_product_id uuid,
  p_quantity numeric,
  p_logged_by uuid default null,
  p_notes text default null
)
returns jsonb
language plpgsql
as $$
DECLARE
  v_bom_header_id    uuid;
  v_order_number     text;
  v_order_id         uuid;
  v_bom_line         RECORD;
  v_available        numeric;
  v_avg_cost         numeric;
  v_total_unit_cost  numeric := 0;
  v_product          products%ROWTYPE;
  v_existing_order   RECORD;
  v_new_completed    numeric;
  v_existing_log_id  uuid;
BEGIN
  IF p_quantity IS NULL OR p_quantity <= 0 THEN
    RAISE EXCEPTION 'Quantity must be greater than 0';
  END IF;

  SELECT * INTO v_product FROM products WHERE id = p_finished_product_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Product % not found', p_finished_product_id;
  END IF;

  SELECT id INTO v_bom_header_id FROM bom_headers
    WHERE (finished_product_id = p_finished_product_id OR product_id = p_finished_product_id)
      AND is_active = true
      AND stage = 'ASSEMBLY'
    ORDER BY created_at DESC
    LIMIT 1;

  IF v_bom_header_id IS NULL THEN
    RAISE EXCEPTION 'No active assembly BOM found for "%"', v_product.name;
  END IF;

  -- Pass 1: check every component has enough stock BEFORE committing
  -- anything, and build the finished good's assembled unit cost from
  -- each component's weighted-average received cost at this warehouse.
  FOR v_bom_line IN
    SELECT component_product_id, quantity_required FROM bom_lines WHERE bom_header_id = v_bom_header_id
  LOOP
    SELECT COALESCE(SUM(quantity), 0) INTO v_available
      FROM inventory_ledger
      WHERE product_id = v_bom_line.component_product_id AND warehouse_id = p_warehouse_id;

    IF v_available < v_bom_line.quantity_required * p_quantity THEN
      RAISE EXCEPTION 'Not enough stock of component % at this warehouse: have %, need %',
        v_bom_line.component_product_id, v_available, v_bom_line.quantity_required * p_quantity;
    END IF;

    SELECT COALESCE(SUM(quantity * unit_cost_etb) / NULLIF(SUM(quantity), 0), 0) INTO v_avg_cost
      FROM inventory_ledger
      WHERE product_id = v_bom_line.component_product_id
        AND warehouse_id = p_warehouse_id
        AND quantity > 0
        AND unit_cost_etb IS NOT NULL;

    v_total_unit_cost := v_total_unit_cost + (COALESCE(v_avg_cost, 0) * v_bom_line.quantity_required);
  END LOOP;

  -- Attach to an existing open order for this BOM+warehouse if one exists
  -- (matching Production.tsx's own logic), instead of always creating a
  -- new, disconnected order.
  SELECT id, order_number, target_quantity, completed_quantity INTO v_existing_order
    FROM production_orders
    WHERE bom_header_id = v_bom_header_id AND warehouse_id = p_warehouse_id
      AND status IN ('DRAFT', 'IN_PROGRESS')
    ORDER BY created_at
    LIMIT 1;

  IF FOUND THEN
    v_order_id := v_existing_order.id;
    v_order_number := v_existing_order.order_number;
    v_new_completed := LEAST(v_existing_order.target_quantity, v_existing_order.completed_quantity + p_quantity);
    UPDATE production_orders SET
      completed_quantity = v_new_completed,
      status = CASE WHEN v_new_completed >= target_quantity THEN 'COMPLETED' ELSE 'IN_PROGRESS' END
    WHERE id = v_order_id;

    SELECT id INTO v_existing_log_id FROM production_daily_logs
      WHERE production_order_id = v_order_id AND log_date = CURRENT_DATE;
    IF FOUND THEN
      UPDATE production_daily_logs SET quantity_produced = quantity_produced + p_quantity WHERE id = v_existing_log_id;
    ELSE
      INSERT INTO production_daily_logs (production_order_id, log_date, quantity_produced, notes, logged_by)
      VALUES (v_order_id, CURRENT_DATE, p_quantity, p_notes, p_logged_by);
    END IF;
  ELSE
    -- No open order to attach to — same-day assembly action, completed
    -- immediately, exactly as before.
    v_order_number := 'PROD-' || to_char(now(), 'YYYYMMDD-HH24MISS');

    INSERT INTO production_orders (
      order_number, bom_header_id, warehouse_id, target_quantity, completed_quantity,
      status, product_id, planned_start_date, actual_start_date, actual_end_date, notes
    ) VALUES (
      v_order_number, v_bom_header_id, p_warehouse_id, p_quantity, p_quantity,
      'COMPLETED', p_finished_product_id, CURRENT_DATE, CURRENT_DATE, CURRENT_DATE, p_notes
    ) RETURNING id INTO v_order_id;

    INSERT INTO production_daily_logs (production_order_id, log_date, quantity_produced, notes, logged_by)
    VALUES (v_order_id, CURRENT_DATE, p_quantity, p_notes, p_logged_by);
  END IF;

  -- Pass 2: consume components (now that we know everything will succeed)
  FOR v_bom_line IN
    SELECT component_product_id, quantity_required FROM bom_lines WHERE bom_header_id = v_bom_header_id
  LOOP
    INSERT INTO inventory_ledger (
      warehouse_id, product_id, movement_type, quantity, unit_cost_etb,
      reference_id, reference_type, notes
    ) VALUES (
      p_warehouse_id, v_bom_line.component_product_id, 'PRODUCTION_CONSUMED',
      -1 * (v_bom_line.quantity_required * p_quantity), NULL,
      v_order_id, 'production_order',
      'Consumed to assemble ' || p_quantity || ' x "' || v_product.name || '"'
    );
  END LOOP;

  -- Credit the finished goods, using the assembled cost computed above
  INSERT INTO inventory_ledger (
    warehouse_id, product_id, movement_type, quantity, unit_cost_etb,
    reference_id, reference_type, notes
  ) VALUES (
    p_warehouse_id, p_finished_product_id, 'PRODUCTION_OUTPUT', p_quantity, v_total_unit_cost,
    v_order_id, 'production_order',
    'Assembled today · order ' || v_order_number
  );

  REFRESH MATERIALIZED VIEW CONCURRENTLY current_inventory;

  RETURN jsonb_build_object(
    'success', true, 'production_order_id', v_order_id,
    'order_number', v_order_number, 'unit_cost_etb', v_total_unit_cost
  );
END;
$$;
