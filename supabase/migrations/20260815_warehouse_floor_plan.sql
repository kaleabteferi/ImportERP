-- Floor plan layer on top of the warehouse_locations table added in Phase 1.
-- Each location gets on-canvas geometry and an optional manual status
-- override; everything else (stock per location, capacity check, move
-- action) keeps working exactly as before -- this is purely additive.

alter table warehouse_locations drop constraint if exists warehouse_locations_location_type_check;
alter table warehouse_locations add constraint warehouse_locations_location_type_check
  check (location_type in ('zone','aisle','shelf','bin','rack','loading','damaged','workspace','staging','floor'));

alter table warehouse_locations add column if not exists pos_x numeric not null default 40;
alter table warehouse_locations add column if not exists pos_y numeric not null default 40;
alter table warehouse_locations add column if not exists width numeric not null default 140 check (width > 0);
alter table warehouse_locations add column if not exists height numeric not null default 90 check (height > 0);
alter table warehouse_locations add column if not exists capacity numeric check (capacity is null or capacity >= 0);
-- Auto-derived state (empty/partial/occupied, from actual stock vs.
-- capacity) is computed client-side from current_inventory_by_location, not
-- stored -- storing it would drift the moment stock moves. manual_status is
-- the only state that needs persisting: it's an operator decision
-- (reserved for an incoming order, restricted for hazardous goods) that
-- stock levels can't infer on their own.
alter table warehouse_locations add column if not exists manual_status text
  check (manual_status is null or manual_status in ('reserved','restricted'));
alter table warehouse_locations add column if not exists notes text;

comment on column warehouse_locations.pos_x is 'Floor-plan canvas X position, warehouse-relative units';
comment on column warehouse_locations.pos_y is 'Floor-plan canvas Y position, warehouse-relative units';
