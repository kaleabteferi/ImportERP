-- Fix: a credit repayment updated credit_accounts.balance but never synced
-- back to the sales_order it was funding. A credit-funded order stayed
-- PARTIAL/INVOICED forever, and the customer's outstanding_etb stayed
-- inflated, even after the customer fully repaid their credit line —
-- because sync_sales_order_paid_amount only ever summed sales_payments,
-- never credit_transactions, despite credit_transactions already having a
-- sales_order_id column (used today only for the draw side, never wired
-- up for repayments).
--
-- Fix: paid_amount is now sum(direct cash payments) + sum(credit
-- repayments explicitly linked to this order via sales_order_id), and the
-- same trigger function now fires from credit_transactions too. A
-- repayment only affects an order's paid_amount when it's linked to one —
-- an unlinked, general credit-line repayment behaves exactly as before
-- (reduces the revolving balance only).
create or replace function sync_sales_order_paid_amount()
returns trigger
language plpgsql
as $$
DECLARE
  v_order_id uuid := COALESCE(NEW.sales_order_id, OLD.sales_order_id);
  v_total    numeric;
  v_paid     numeric;
BEGIN
  IF v_order_id IS NULL THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  SELECT total_etb INTO v_total FROM sales_orders WHERE id = v_order_id;

  SELECT
    COALESCE((SELECT SUM(amount_etb) FROM sales_payments WHERE sales_order_id = v_order_id), 0)
    + COALESCE((SELECT SUM(amount) FROM credit_transactions WHERE sales_order_id = v_order_id AND type = 'repayment'), 0)
  INTO v_paid;

  UPDATE sales_orders SET
    paid_amount = v_paid,
    status = CASE
      WHEN v_paid <= 0 THEN 'INVOICED'
      WHEN v_paid < COALESCE(v_total, 0) THEN 'PARTIAL'
      ELSE 'PAID'
    END,
    updated_at = now()
  WHERE id = v_order_id;

  PERFORM update_customer_outstanding(v_order_id);
  RETURN COALESCE(NEW, OLD);
END;
$$;

drop trigger if exists trg_sync_sales_order_paid_from_credit on credit_transactions;
create trigger trg_sync_sales_order_paid_from_credit
  after insert or delete or update on credit_transactions
  for each row execute function sync_sales_order_paid_amount();
