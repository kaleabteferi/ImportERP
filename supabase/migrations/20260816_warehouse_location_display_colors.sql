-- Operator-selected floor-plan colors are visual grouping metadata only.
-- Occupancy and restriction status remain derived independently, so choosing
-- a color cannot hide or alter the operational state of a storage area.
alter table warehouse_locations
  add column if not exists display_color text
  check (
    display_color is null
    or display_color in ('lime', 'blue', 'teal', 'violet', 'amber', 'rose', 'slate')
  );

comment on column warehouse_locations.display_color is
  'Optional curated floor-plan color key used to visually group storage areas';
