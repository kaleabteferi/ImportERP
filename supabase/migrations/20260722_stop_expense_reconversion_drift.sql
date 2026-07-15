-- Bug: recalculate_shipment_costs() unconditionally rewrote amount_etb for
-- EVERY expense on a shipment (including already-FINAL/locked ones) using
-- whatever USD->ETB rate happened to be active at call time. This function
-- runs as a side effect of adding/editing/deleting ANY expense on the
-- shipment, and of receive_shipment() -- so touching one expense silently
-- re-priced every other expense on the shipment at today's rate, discarding
-- the rate that was actually in effect (or manually confirmed) when each
-- one was recorded. Each expense already carries its own correct amount_etb
-- (set once, at entry time, by add/update_expense_and_recalculate) -- this
-- function only needs to re-sum those existing totals to reallocate item
-- landed costs, not reconvert them.
--
-- Same bug in finalize_shipment_costs(): it recomputed amount_etb from
-- amount * p_usd_to_etb for every PROVISIONAL expense, silently overwriting
-- any manual override the user made in the Cost Finalization review step
-- (useCostFinalization.ts -> updateExpenseAmount, which intentionally only
-- touches amount_etb and leaves amount/currency alone).

CREATE OR REPLACE FUNCTION public.recalculate_shipment_costs(p_shipment_id uuid, p_usd_to_etb numeric DEFAULT NULL::numeric)
 RETURNS jsonb
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_shipment          shipments%ROWTYPE;
  v_effective_rate    NUMERIC;
  v_total_expenses    NUMERIC;
  v_total_basis       NUMERIC;
  v_item              RECORD;
  v_basis             NUMERIC;
  v_allocated_cost    NUMERIC;
  v_unit_cost         NUMERIC;
  v_result_items      JSONB := '[]';
  v_expense_breakdown JSONB;
BEGIN
  -- 1. Lock & fetch shipment
  SELECT * INTO v_shipment
  FROM shipments
  WHERE id = p_shipment_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Shipment % not found', p_shipment_id;
  END IF;

  -- 2. Resolve exchange rate (used for item value calc only -- expenses
  --    already carry their own correct amount_etb, see note above)
  IF p_usd_to_etb IS NOT NULL AND p_usd_to_etb > 0 THEN
    v_effective_rate := p_usd_to_etb;
  ELSE
    SELECT rate INTO v_effective_rate
    FROM forex_rates
    WHERE from_currency = 'USD'
      AND to_currency   = 'ETB'
      AND rate_type     = 'CUSTOMS'
    ORDER BY effective_date DESC
    LIMIT 1;

    IF v_effective_rate IS NULL THEN
      RAISE EXCEPTION 'No USD→ETB customs rate found. Please add one in forex_rates.';
    END IF;
  END IF;

  -- 3. Sum existing expenses for this shipment (in ETB) -- do NOT reconvert
  --    them here; each row's amount_etb was already set correctly when it
  --    was created or edited, at the rate in effect at that time.
  SELECT COALESCE(SUM(amount_etb), 0)
  INTO v_total_expenses
  FROM shipment_expenses
  WHERE shipment_id = p_shipment_id;

  -- 4. Calculate total allocation basis across all items
  SELECT COALESCE(SUM(
    get_item_allocation_basis(
      si.quantity,
      si.weight_kg_total,
      si.volume_m3_total,
      si.unit_price_usd,
      v_effective_rate,
      v_shipment.allocation_method
    )
  ), 0)
  INTO v_total_basis
  FROM shipment_items si
  WHERE si.shipment_id = p_shipment_id;

  IF v_total_basis = 0 THEN
    RAISE EXCEPTION
      'Total allocation basis is 0 for method %. Check item data (weight/volume/quantity).',
      v_shipment.allocation_method;
  END IF;

  -- 5. Allocate to each item & update rows
  FOR v_item IN
    SELECT
      si.id,
      si.product_id,
      si.quantity,
      si.unit_price_usd,
      si.weight_kg_total,
      si.volume_m3_total,
      si.cost_status,
      p.name  AS product_name,
      p.sku   AS product_sku
    FROM shipment_items si
    JOIN products p ON p.id = si.product_id
    WHERE si.shipment_id = p_shipment_id
    ORDER BY p.name
  LOOP
    v_basis := get_item_allocation_basis(
      v_item.quantity,
      v_item.weight_kg_total,
      v_item.volume_m3_total,
      v_item.unit_price_usd,
      v_effective_rate,
      v_shipment.allocation_method
    );

    v_allocated_cost := ROUND(
      (v_basis / v_total_basis) * v_total_expenses,
      4
    );

    v_unit_cost := CASE
      WHEN v_item.quantity > 0
      THEN ROUND(v_allocated_cost / v_item.quantity, 4)
      ELSE 0
    END;

    UPDATE shipment_items
    SET
      allocated_cost_etb   = v_allocated_cost,
      unit_landed_cost_etb = v_unit_cost,
      cost_calculated_at   = NOW()
    WHERE id = v_item.id
      AND cost_status = 'PROVISIONAL';

    v_result_items := v_result_items || jsonb_build_object(
      'shipment_item_id',     v_item.id,
      'product_id',           v_item.product_id,
      'product_name',         v_item.product_name,
      'product_sku',          v_item.product_sku,
      'quantity',             v_item.quantity,
      'unit_price_usd',       v_item.unit_price_usd,
      'product_value_usd',    v_item.quantity * v_item.unit_price_usd,
      'product_value_etb',    v_item.quantity * v_item.unit_price_usd * v_effective_rate,
      'allocation_basis',     v_basis,
      'allocation_share_pct', ROUND((v_basis / v_total_basis) * 100, 2),
      'allocated_cost_etb',   v_allocated_cost,
      'unit_landed_cost_etb', v_unit_cost,
      'cost_status',          v_item.cost_status,
      'is_protected',         (v_item.cost_status = 'FINAL')
    );
  END LOOP;

  -- 6. Build expense breakdown by category for the UI
  SELECT jsonb_agg(
    jsonb_build_object(
      'category',        cat_totals.category,
      'total_etb',       cat_totals.total_etb,
      'count',           cat_totals.item_count,
      'has_provisional', cat_totals.has_provisional
    )
    ORDER BY cat_totals.category
  )
  INTO v_expense_breakdown
  FROM (
    SELECT
      category,
      ROUND(SUM(amount_etb), 2)            AS total_etb,
      COUNT(*)                             AS item_count,
      BOOL_OR(cost_status = 'PROVISIONAL') AS has_provisional
    FROM shipment_expenses
    WHERE shipment_id = p_shipment_id
    GROUP BY category
  ) cat_totals;

  -- 7. Return full payload
  RETURN jsonb_build_object(
    'shipment_id',        p_shipment_id,
    'allocation_method',  v_shipment.allocation_method,
    'exchange_rate',      v_effective_rate,
    'total_expenses_etb', ROUND(v_total_expenses, 2),
    'total_basis',        v_total_basis,
    'calculated_at',      NOW(),
    'items',              v_result_items,
    'expense_breakdown',  COALESCE(v_expense_breakdown, '[]')
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.finalize_shipment_costs(p_shipment_id uuid, p_usd_to_etb numeric, p_method cost_allocation_method DEFAULT 'QUANTITY'::cost_allocation_method)
 RETURNS jsonb
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_item          RECORD;
  v_total_overhead NUMERIC;
  v_total_basis   NUMERIC;
  v_basis         NUMERIC;
  v_unit_landed   NUMERIC;
  v_allocated     NUMERIC;
  v_old_cost      NUMERIC;
  v_results       JSONB := '[]';
  v_qty_sold      NUMERIC;
  v_qty_on_hand   NUMERIC;
BEGIN
  -- 1. Lock the shipment row
  PERFORM id FROM shipments
  WHERE id = p_shipment_id FOR UPDATE;

  -- 2. Mark all provisional expenses as FINAL. amount_etb is left as-is:
  --    it was already set correctly when each expense was created/edited,
  --    or explicitly overridden by the user in the finalization review
  --    step (updateExpenseAmount) -- recomputing it here from amount *
  --    p_usd_to_etb would silently discard that.
  UPDATE shipment_expenses
  SET
    cost_status   = 'FINAL',
    exchange_rate = p_usd_to_etb,
    updated_at    = NOW()
  WHERE shipment_id = p_shipment_id
    AND cost_status = 'PROVISIONAL';

  -- 3. Sum all expenses (now all FINAL)
  SELECT COALESCE(SUM(amount_etb), 0)
  INTO v_total_overhead
  FROM shipment_expenses
  WHERE shipment_id = p_shipment_id;

  -- 4. Total basis across all items
  SELECT COALESCE(SUM(
    CASE p_method
      WHEN 'QUANTITY' THEN quantity
      WHEN 'WEIGHT'   THEN COALESCE(weight_kg_total, quantity)
      WHEN 'VOLUME'   THEN COALESCE(volume_m3_total, quantity)
      WHEN 'VALUE'    THEN quantity * unit_price_usd * p_usd_to_etb
    END
  ), 0)
  INTO v_total_basis
  FROM shipment_items
  WHERE shipment_id = p_shipment_id;

  IF v_total_basis = 0 THEN
    RAISE EXCEPTION 'Cannot finalize: zero allocation basis for method %', p_method;
  END IF;

  -- 5. Update each item and record cost adjustment
  FOR v_item IN
    SELECT
      si.id,
      si.product_id,
      si.quantity,
      si.unit_price_usd,
      si.unit_landed_cost_etb AS old_unit_cost,
      COALESCE(si.weight_kg_total, si.quantity) AS weight,
      COALESCE(si.volume_m3_total, si.quantity) AS volume,
      p.name AS product_name
    FROM shipment_items si
    JOIN products p ON p.id = si.product_id
    WHERE si.shipment_id = p_shipment_id
      AND si.cost_status = 'PROVISIONAL'
    FOR UPDATE OF si
  LOOP
    v_basis := CASE p_method
      WHEN 'QUANTITY' THEN v_item.quantity
      WHEN 'WEIGHT'   THEN v_item.weight
      WHEN 'VOLUME'   THEN v_item.volume
      WHEN 'VALUE'    THEN v_item.quantity * v_item.unit_price_usd * p_usd_to_etb
    END;

    v_allocated   := ROUND((v_basis / v_total_basis) * v_total_overhead, 4);
    v_unit_landed := ROUND(v_item.unit_price_usd * p_usd_to_etb + v_allocated / v_item.quantity, 4);
    v_old_cost    := COALESCE(v_item.old_unit_cost, 0);

    -- Get qty sold (to record in adjustment)
    SELECT COALESCE(ABS(SUM(quantity)), 0)
    INTO v_qty_sold
    FROM inventory_ledger
    WHERE product_id   = v_item.product_id
      AND reference_id = v_item.id
      AND movement_type = 'SALE';

    -- Get current on-hand
    SELECT COALESCE(SUM(quantity), 0)
    INTO v_qty_on_hand
    FROM inventory_ledger
    WHERE product_id = v_item.product_id;

    -- Lock the unit cost
    UPDATE shipment_items SET
      unit_landed_cost_etb = v_unit_landed,
      allocated_cost_etb   = v_allocated,
      cost_status          = 'FINAL',
      cost_calculated_at   = NOW()
    WHERE id = v_item.id;

    -- Record adjustment for audit trail
    INSERT INTO cost_adjustments (
      shipment_item_id,
      adjustment_date,
      provisional_unit_cost_etb,
      final_unit_cost_etb,
      quantity_on_hand_at_adjustment,
      quantity_already_sold,
      reason
    ) VALUES (
      v_item.id,
      CURRENT_DATE,
      v_old_cost,
      v_unit_landed,
      v_qty_on_hand,
      v_qty_sold,
      'Cost finalization — final expenses confirmed'
    );

    -- If remaining inventory exists, add a value adjustment entry
    IF v_qty_on_hand > 0 AND ABS(v_unit_landed - v_old_cost) > 0.01 THEN
      INSERT INTO inventory_ledger (
        warehouse_id,
        product_id,
        movement_type,
        quantity,
        unit_cost_etb,
        reference_id,
        reference_type,
        notes
      )
      SELECT
        il.warehouse_id,
        v_item.product_id,
        'ADJUSTMENT',
        0,
        v_unit_landed - v_old_cost,
        v_item.id,
        'cost_finalization',
        'Cost finalized: ' || v_old_cost || ' → ' || v_unit_landed || ' ETB/unit'
      FROM inventory_ledger il
      WHERE il.product_id = v_item.product_id
      LIMIT 1;
    END IF;

    v_results := v_results || jsonb_build_object(
      'product_name',         v_item.product_name,
      'old_unit_cost',        v_old_cost,
      'new_unit_cost',        v_unit_landed,
      'change_per_unit',      ROUND(v_unit_landed - v_old_cost, 2),
      'qty_on_hand',          v_qty_on_hand,
      'qty_already_sold',     v_qty_sold,
      'inventory_adjustment', ROUND((v_unit_landed - v_old_cost) * v_qty_on_hand, 2)
    );
  END LOOP;

  -- 6. Update shipment status to COMPLETED
  UPDATE shipments
  SET status     = 'COMPLETED',
      updated_at = NOW()
  WHERE id = p_shipment_id;

  -- 7. Refresh inventory materialized view
  REFRESH MATERIALIZED VIEW CONCURRENTLY current_inventory;

  RETURN jsonb_build_object(
    'shipment_id',     p_shipment_id,
    'finalized_at',    NOW(),
    'total_overhead',  v_total_overhead,
    'exchange_rate',   p_usd_to_etb,
    'method',          p_method,
    'items',           v_results
  );
END;
$function$;
