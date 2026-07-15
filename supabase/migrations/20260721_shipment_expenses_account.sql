-- Paying a shipment expense (Payables -> Mark as paid) had no way to record
-- which account the money left from, and marked-paid shipment expenses were
-- entirely invisible to Money Tracking (it only reads sales_payments,
-- purchase_order_payments, credit_transactions, company_expenses).
ALTER TABLE shipment_expenses ADD COLUMN IF NOT EXISTS account_id uuid REFERENCES accounts(id);
