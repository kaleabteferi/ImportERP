-- Real UI now exists for the PI/container flow (Proforma Invoices pages),
-- so operations_marketing (the role that already owns Shipments/Suppliers/
-- Djibouti Forwarder/Customs Estimator) needs write access to it. Until now
-- these five tables were full_access-only per 20260717_harden_rls_by_role.sql
-- ("no reachable UI write path" at the time). customs_declarations,
-- customs_line_items, and demurrage_events stay full_access-only -- those
-- remain separate, not-yet-built backlog items.

drop policy if exists "write_scoped" on proforma_invoices;
create policy "write_scoped" on proforma_invoices for all
  using (has_role(ARRAY['operations_marketing']))
  with check (has_role(ARRAY['operations_marketing']));

drop policy if exists "write_scoped" on pi_items;
create policy "write_scoped" on pi_items for all
  using (has_role(ARRAY['operations_marketing']))
  with check (has_role(ARRAY['operations_marketing']));

drop policy if exists "write_scoped" on containers;
create policy "write_scoped" on containers for all
  using (has_role(ARRAY['operations_marketing']))
  with check (has_role(ARRAY['operations_marketing']));

drop policy if exists "write_scoped" on packing_lists;
create policy "write_scoped" on packing_lists for all
  using (has_role(ARRAY['operations_marketing']))
  with check (has_role(ARRAY['operations_marketing']));

drop policy if exists "write_scoped" on pl_items;
create policy "write_scoped" on pl_items for all
  using (has_role(ARRAY['operations_marketing']))
  with check (has_role(ARRAY['operations_marketing']));
