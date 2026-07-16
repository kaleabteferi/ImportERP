-- Harden RLS to actually enforce roles server-side. Until now almost every
-- table's policy was just `auth.role() = 'authenticated'` — any logged-in
-- user, including a brand-new 'pending' account with no assigned role,
-- had full read/write access to every table. The role system in
-- src/lib/roles.ts only gated the UI. This migration:
--   1. Adds has_active_role() — true for any real (non-'pending') role.
--   2. Replaces the blanket policy on every business table with a broad
--      SELECT (has_active_role()) + a role-scoped write policy, matching
--      exactly which roles' pages actually write to that table today
--      (traced through every .insert/.update/.delete call and every RPC
--      side-effect/trigger, so this doesn't lock out any real workflow).
--   3. Preserves the existing company-scoping (user_can_access_company)
--      wherever it already applied, just AND'd with the new role check.
--   4. Fixes profiles/companies, which had a broad "Authenticated only"
--      policy coexisting with a narrower one — Postgres ORs permissive
--      policies together, so the broad one was silently winning.
-- has_role(...) already OR's in has_full_access(), so 'full_access' always
-- passes every check below without needing a separate policy.

create or replace function has_active_role()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select current_role_name() is not null and current_role_name() <> 'pending';
$$;

-- ---------------------------------------------------------------------
-- Settings/HR-owned reference data (Settings.tsx, hr_system)
-- ---------------------------------------------------------------------

drop policy if exists "Authenticated only" on accounts;
create policy "select_active_role" on accounts for select using (has_active_role());
create policy "write_scoped" on accounts for all using (has_role(ARRAY['hr_system'])) with check (has_role(ARRAY['hr_system']));

drop policy if exists "Authenticated only" on company_settings;
create policy "select_active_role" on company_settings for select using (has_active_role());
create policy "write_scoped" on company_settings for all using (has_role(ARRAY['hr_system'])) with check (has_role(ARRAY['hr_system']));

drop policy if exists "Authenticated only" on consignees;
create policy "select_active_role" on consignees for select using (has_active_role());
create policy "write_scoped" on consignees for all using (has_role(ARRAY['hr_system'])) with check (has_role(ARRAY['hr_system']));

drop policy if exists "Authenticated only" on forex_rates;
create policy "select_active_role" on forex_rates for select using (has_active_role());
create policy "write_scoped" on forex_rates for all using (has_role(ARRAY['hr_system'])) with check (has_role(ARRAY['hr_system']));

drop policy if exists "Authenticated only" on warehouses;
create policy "select_active_role" on warehouses for select using (has_active_role());
create policy "write_scoped" on warehouses for all using (has_role(ARRAY['hr_system'])) with check (has_role(ARRAY['hr_system']));

-- companies: existing policies ("Full access manage companies",
-- "Authenticated only", "Authenticated read companies") disagreed with each
-- other AND with reality — the only page that actually writes companies is
-- Settings.tsx, gated hr_system. Match what the app actually does.
drop policy if exists "Full access manage companies" on companies;
drop policy if exists "Authenticated only" on companies;
drop policy if exists "Authenticated read companies" on companies;
create policy "select_active_role" on companies for select using (has_active_role());
create policy "write_scoped" on companies for all using (has_role(ARRAY['hr_system'])) with check (has_role(ARRAY['hr_system']));

-- ---------------------------------------------------------------------
-- Operations (Shipments/Suppliers/Djibouti — operations_marketing)
-- ---------------------------------------------------------------------

drop policy if exists "Authenticated only" on suppliers;
create policy "select_active_role" on suppliers for select using (has_active_role());
create policy "write_scoped" on suppliers for all using (has_role(ARRAY['operations_marketing'])) with check (has_role(ARRAY['operations_marketing']));

drop policy if exists "Authenticated only" on shipment_attachments;
create policy "select_active_role" on shipment_attachments for select using (has_active_role());
create policy "write_scoped" on shipment_attachments for all using (has_role(ARRAY['operations_marketing'])) with check (has_role(ARRAY['operations_marketing']));

drop policy if exists "Authenticated only" on shipment_timeline;
create policy "select_active_role" on shipment_timeline for select using (has_active_role());
create policy "write_scoped" on shipment_timeline for all using (has_role(ARRAY['operations_marketing'])) with check (has_role(ARRAY['operations_marketing']));

drop policy if exists "Authenticated only" on demurrage_rates;
create policy "select_active_role" on demurrage_rates for select using (has_active_role());
create policy "write_scoped" on demurrage_rates for all using (has_role(ARRAY['operations_marketing'])) with check (has_role(ARRAY['operations_marketing']));

-- shipments: operations_marketing (create/manage) + accounting_finance
-- (cost finalization flips status to COMPLETED via finalize_shipment_costs).
-- Company scoping preserved.
drop policy if exists "Company scoped access" on shipments;
create policy "select_active_role" on shipments for select using (has_active_role() and user_can_access_company(company_id));
create policy "write_scoped" on shipments for all
  using (has_role(ARRAY['operations_marketing','accounting_finance']) and user_can_access_company(company_id))
  with check (has_role(ARRAY['operations_marketing','accounting_finance']) and user_can_access_company(company_id));

-- shipment_items / shipment_expenses: same two roles, company-scoped via
-- the parent shipment (ExpenseForm/finalize/Payables "mark as paid"/Djibouti
-- dispatch all write shipment_expenses; ShipmentDetail + finalize write
-- shipment_items).
drop policy if exists "Company scoped via shipment" on shipment_items;
create policy "select_active_role" on shipment_items for select using (
  has_active_role() and exists (select 1 from shipments s where s.id = shipment_items.shipment_id and user_can_access_company(s.company_id))
);
create policy "write_scoped" on shipment_items for all
  using (has_role(ARRAY['operations_marketing','accounting_finance']) and exists (select 1 from shipments s where s.id = shipment_items.shipment_id and user_can_access_company(s.company_id)))
  with check (has_role(ARRAY['operations_marketing','accounting_finance']) and exists (select 1 from shipments s where s.id = shipment_items.shipment_id and user_can_access_company(s.company_id)));

drop policy if exists "Company scoped via shipment" on shipment_expenses;
create policy "select_active_role" on shipment_expenses for select using (
  has_active_role() and exists (select 1 from shipments s where s.id = shipment_expenses.shipment_id and user_can_access_company(s.company_id))
);
create policy "write_scoped" on shipment_expenses for all
  using (has_role(ARRAY['operations_marketing','accounting_finance']) and exists (select 1 from shipments s where s.id = shipment_expenses.shipment_id and user_can_access_company(s.company_id)))
  with check (has_role(ARRAY['operations_marketing','accounting_finance']) and exists (select 1 from shipments s where s.id = shipment_expenses.shipment_id and user_can_access_company(s.company_id)));

drop policy if exists "Authenticated only" on cost_adjustments;
create policy "select_active_role" on cost_adjustments for select using (has_active_role());
create policy "write_scoped" on cost_adjustments for all using (has_role(ARRAY['operations_marketing','accounting_finance'])) with check (has_role(ARRAY['operations_marketing','accounting_finance']));

-- ---------------------------------------------------------------------
-- Manufacturing (Production/Assembly/BOMs — manufacturing_sales)
-- ---------------------------------------------------------------------

drop policy if exists "Authenticated only" on bom_headers;
create policy "select_active_role" on bom_headers for select using (has_active_role());
create policy "write_scoped" on bom_headers for all using (has_role(ARRAY['manufacturing_sales'])) with check (has_role(ARRAY['manufacturing_sales']));

drop policy if exists "Authenticated only" on bom_lines;
create policy "select_active_role" on bom_lines for select using (has_active_role());
create policy "write_scoped" on bom_lines for all using (has_role(ARRAY['manufacturing_sales'])) with check (has_role(ARRAY['manufacturing_sales']));

drop policy if exists "Authenticated only" on production_daily_logs;
create policy "select_active_role" on production_daily_logs for select using (has_active_role());
create policy "write_scoped" on production_daily_logs for all using (has_role(ARRAY['manufacturing_sales'])) with check (has_role(ARRAY['manufacturing_sales']));

drop policy if exists "Company scoped access" on production_orders;
create policy "select_active_role" on production_orders for select using (has_active_role() and user_can_access_company(company_id));
create policy "write_scoped" on production_orders for all
  using (has_role(ARRAY['manufacturing_sales']) and user_can_access_company(company_id))
  with check (has_role(ARRAY['manufacturing_sales']) and user_can_access_company(company_id));

drop policy if exists "Authenticated only" on damage_reports;
create policy "select_active_role" on damage_reports for select using (has_active_role());
create policy "write_scoped" on damage_reports for all using (has_role(ARRAY['manufacturing_sales'])) with check (has_role(ARRAY['manufacturing_sales']));

-- ---------------------------------------------------------------------
-- Shared operational (Products/Customers/Inventory/Warehouse transfers)
-- ---------------------------------------------------------------------

drop policy if exists "Authenticated only" on products;
create policy "select_active_role" on products for select using (has_active_role());
create policy "write_scoped" on products for all using (has_role(ARRAY['operations_marketing','manufacturing_sales'])) with check (has_role(ARRAY['operations_marketing','manufacturing_sales']));

drop policy if exists "Authenticated only" on customers;
create policy "select_active_role" on customers for select using (has_active_role());
create policy "write_scoped" on customers for all using (has_role(ARRAY['operations_marketing','manufacturing_sales','accounting_finance'])) with check (has_role(ARRAY['operations_marketing','manufacturing_sales','accounting_finance']));

drop policy if exists "Authenticated only" on inventory_ledger;
create policy "select_active_role" on inventory_ledger for select using (has_active_role());
create policy "write_scoped" on inventory_ledger for all using (has_role(ARRAY['operations_marketing','manufacturing_sales','accounting_finance'])) with check (has_role(ARRAY['operations_marketing','manufacturing_sales','accounting_finance']));

drop policy if exists "Authenticated all warehouse_transfers" on warehouse_transfers;
create policy "select_active_role" on warehouse_transfers for select using (has_active_role());
create policy "write_scoped" on warehouse_transfers for all using (has_role(ARRAY['operations_marketing','manufacturing_sales','accounting_finance'])) with check (has_role(ARRAY['operations_marketing','manufacturing_sales','accounting_finance']));

-- ---------------------------------------------------------------------
-- Sales (manufacturing_sales + accounting_finance both reach /sales)
-- ---------------------------------------------------------------------

drop policy if exists "Company scoped access" on sales_orders;
create policy "select_active_role" on sales_orders for select using (has_active_role() and user_can_access_company(company_id));
create policy "write_scoped" on sales_orders for all
  using (has_role(ARRAY['manufacturing_sales','accounting_finance']) and user_can_access_company(company_id))
  with check (has_role(ARRAY['manufacturing_sales','accounting_finance']) and user_can_access_company(company_id));

drop policy if exists "Company scoped via sales_order" on sales_order_lines;
create policy "select_active_role" on sales_order_lines for select using (
  has_active_role() and exists (select 1 from sales_orders o where o.id = sales_order_lines.sales_order_id and user_can_access_company(o.company_id))
);
create policy "write_scoped" on sales_order_lines for all
  using (has_role(ARRAY['manufacturing_sales','accounting_finance']) and exists (select 1 from sales_orders o where o.id = sales_order_lines.sales_order_id and user_can_access_company(o.company_id)))
  with check (has_role(ARRAY['manufacturing_sales','accounting_finance']) and exists (select 1 from sales_orders o where o.id = sales_order_lines.sales_order_id and user_can_access_company(o.company_id)));

drop policy if exists "Authenticated only" on sales_payments;
create policy "select_active_role" on sales_payments for select using (has_active_role());
create policy "write_scoped" on sales_payments for all using (has_role(ARRAY['manufacturing_sales','accounting_finance'])) with check (has_role(ARRAY['manufacturing_sales','accounting_finance']));

-- credit_accounts: opened from Customers/Sales (ops+mfg+finance) too, not
-- just Credit Accounts page.
drop policy if exists "Authenticated only" on credit_accounts;
create policy "select_active_role" on credit_accounts for select using (has_active_role());
create policy "write_scoped" on credit_accounts for all using (has_role(ARRAY['accounting_finance','operations_marketing','manufacturing_sales'])) with check (has_role(ARRAY['accounting_finance','operations_marketing','manufacturing_sales']));

drop policy if exists "Authenticated only" on credit_transactions;
create policy "select_active_role" on credit_transactions for select using (has_active_role());
create policy "write_scoped" on credit_transactions for all using (has_role(ARRAY['accounting_finance','manufacturing_sales'])) with check (has_role(ARRAY['accounting_finance','manufacturing_sales']));

-- ---------------------------------------------------------------------
-- Finance (accounting_finance)
-- ---------------------------------------------------------------------

drop policy if exists "Authenticated only" on purchase_order_payments;
create policy "select_active_role" on purchase_order_payments for select using (has_active_role());
create policy "write_scoped" on purchase_order_payments for all using (has_role(ARRAY['accounting_finance'])) with check (has_role(ARRAY['accounting_finance']));

-- purchase_orders: no page in the app ever creates one — only paid_amount
-- gets updated (via a trigger on purchase_order_payments). Split so INSERT/
-- DELETE stay full_access-only (has_role with an empty role array still
-- passes for full_access, since has_role() ORs in has_full_access()) rather
-- than newly granting a capability nothing in the UI has ever used.
drop policy if exists "Company scoped access" on purchase_orders;
create policy "select_active_role" on purchase_orders for select using (has_active_role() and user_can_access_company(company_id));
create policy "update_scoped" on purchase_orders for update
  using (has_role(ARRAY['accounting_finance']) and user_can_access_company(company_id))
  with check (has_role(ARRAY['accounting_finance']) and user_can_access_company(company_id));
create policy "insert_full_access_only" on purchase_orders for insert
  with check (has_role(ARRAY[]::text[]) and user_can_access_company(company_id));
create policy "delete_full_access_only" on purchase_orders for delete
  using (has_role(ARRAY[]::text[]) and user_can_access_company(company_id));

drop policy if exists "Company scoped access" on company_expenses;
create policy "select_active_role" on company_expenses for select using (has_active_role() and user_can_access_company(company_id));
create policy "write_scoped" on company_expenses for all
  using (has_role(ARRAY['accounting_finance']) and user_can_access_company(company_id))
  with check (has_role(ARRAY['accounting_finance']) and user_can_access_company(company_id));

-- ---------------------------------------------------------------------
-- No reachable UI write path today — read stays open to any active role,
-- write drops to full_access only (has_role with an empty array).
-- ---------------------------------------------------------------------

drop policy if exists "Authenticated only" on containers;
create policy "select_active_role" on containers for select using (has_active_role());
create policy "write_scoped" on containers for all using (has_role(ARRAY[]::text[])) with check (has_role(ARRAY[]::text[]));

drop policy if exists "Authenticated only" on customs_declarations;
create policy "select_active_role" on customs_declarations for select using (has_active_role());
create policy "write_scoped" on customs_declarations for all using (has_role(ARRAY[]::text[])) with check (has_role(ARRAY[]::text[]));

drop policy if exists "Authenticated only" on customs_line_items;
create policy "select_active_role" on customs_line_items for select using (has_active_role());
create policy "write_scoped" on customs_line_items for all using (has_role(ARRAY[]::text[])) with check (has_role(ARRAY[]::text[]));

drop policy if exists "Authenticated only" on demurrage_events;
create policy "select_active_role" on demurrage_events for select using (has_active_role());
create policy "write_scoped" on demurrage_events for all using (has_role(ARRAY[]::text[])) with check (has_role(ARRAY[]::text[]));

drop policy if exists "Authenticated only" on employees;
create policy "select_active_role" on employees for select using (has_active_role());
create policy "write_scoped" on employees for all using (has_role(ARRAY[]::text[])) with check (has_role(ARRAY[]::text[]));

drop policy if exists "Authenticated only" on packing_lists;
create policy "select_active_role" on packing_lists for select using (has_active_role());
create policy "write_scoped" on packing_lists for all using (has_role(ARRAY[]::text[])) with check (has_role(ARRAY[]::text[]));

drop policy if exists "Authenticated only" on pi_items;
create policy "select_active_role" on pi_items for select using (has_active_role());
create policy "write_scoped" on pi_items for all using (has_role(ARRAY[]::text[])) with check (has_role(ARRAY[]::text[]));

drop policy if exists "Authenticated only" on pl_items;
create policy "select_active_role" on pl_items for select using (has_active_role());
create policy "write_scoped" on pl_items for all using (has_role(ARRAY[]::text[])) with check (has_role(ARRAY[]::text[]));

drop policy if exists "Authenticated only" on proforma_invoices;
create policy "select_active_role" on proforma_invoices for select using (has_active_role());
create policy "write_scoped" on proforma_invoices for all using (has_role(ARRAY[]::text[])) with check (has_role(ARRAY[]::text[]));

-- ---------------------------------------------------------------------
-- profiles: had "Authenticated only" (FOR ALL, any authenticated user)
-- coexisting with the correctly-scoped "read own or admin" / "update own
-- row or admin" — permissive policies OR together, so the broad one was
-- silently winning. Drop only the broad one; the other two are already
-- correct. New profile rows are inserted by the SECURITY DEFINER
-- handle_new_user() trigger, which bypasses RLS, so no INSERT policy is
-- needed here.
-- ---------------------------------------------------------------------

drop policy if exists "Authenticated only" on profiles;
