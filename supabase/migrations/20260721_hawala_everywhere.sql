-- Adds hawala as a selectable payment method everywhere the app already
-- lets someone pick cash/bank_transfer/credit/mobile_money, not just the
-- dedicated Supplier Payments page. shipment_expenses and company_expenses
-- carry a foreign currency, so they get the full breakdown (route, ETB
-- handed to the dealer, rate quoted, computed amount in the expense's own
-- currency) — the same shape already used on supplier_payments.
-- sales_payments and credit_transactions are always ETB-denominated (no
-- currency column), so there's nothing to convert — they just get hawala
-- as a selectable method plus a route field for record-keeping.

alter table shipment_expenses drop constraint shipment_expenses_payment_method_check;
alter table shipment_expenses add constraint shipment_expenses_payment_method_check
  check (payment_method = any (array['cash','bank_transfer','credit','mobile_money','hawala']));
alter table shipment_expenses add column hawala_route text;
alter table shipment_expenses add column hawala_etb_amount numeric;
alter table shipment_expenses add column hawala_exchange_rate numeric;

alter table company_expenses drop constraint company_expenses_method_check;
alter table company_expenses add constraint company_expenses_method_check
  check (method = any (array['cash','bank_transfer','credit','mobile_money','hawala']));
alter table company_expenses add column hawala_route text;
alter table company_expenses add column hawala_etb_amount numeric;
alter table company_expenses add column hawala_exchange_rate numeric;

alter table sales_payments drop constraint sales_payments_method_check;
alter table sales_payments add constraint sales_payments_method_check
  check (method = any (array['cash','bank_transfer','credit','mobile_money','hawala']));
alter table sales_payments add column hawala_route text;

alter table credit_transactions drop constraint credit_transactions_method_check;
alter table credit_transactions add constraint credit_transactions_method_check
  check (method = any (array['cash','bank_transfer','credit','mobile_money','hawala']));
alter table credit_transactions add column hawala_route text;
