-- Container fill (%) is computed from pl_items.total_volume_m3, a generated
-- column driven by per-carton length_cm/width_cm/height_cm -- but nothing
-- in the app has ever offered a way to enter those dimensions (the packing
-- list's quick-add form only asks for cartons + units/carton), so real
-- containers show 0% fill regardless of what's actually packed.
--
-- Fix: let each product carry its own standard carton size once, then
-- auto-fill the packing list's dimension fields from it the same way
-- default_customs_value already pre-fills CD value -- only when the field
-- is still blank, never overwriting a manual per-shipment override.
alter table products add column if not exists carton_length_cm numeric(8,2);
alter table products add column if not exists carton_width_cm numeric(8,2);
alter table products add column if not exists carton_height_cm numeric(8,2);
alter table products add column if not exists default_units_per_carton numeric(10,2);
