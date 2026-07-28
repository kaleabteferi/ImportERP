-- Per-product default customs (CD) value -- a reference/default figure per
-- product that pre-fills pi_items.customs_value when adding a proforma
-- invoice line for that product, per the user's "CD value entry for every
-- item (editable) in the product list" request. Additive, nullable, no
-- effect on existing rows.
alter table products add column if not exists default_customs_value numeric(12,2);
