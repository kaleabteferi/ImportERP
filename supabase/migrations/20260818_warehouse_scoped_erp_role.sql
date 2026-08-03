-- Make warehouse staff a first-class ERP role without turning a warehouse
-- assignment into company-wide access. The browser uses the same two-part
-- model: profiles.role = warehouse_operations + one or more active unit
-- assignments.

create or replace function has_head_office_role()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select current_role_name() in (
    'full_access', 'accounting_finance', 'operations_marketing',
    'manufacturing_sales', 'hr_system'
  );
$$;

create or replace function user_can_view_warehouse(p_warehouse_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select has_head_office_role() or exists (
    select 1
    from operational_units ou
    where ou.warehouse_id = p_warehouse_id
      and ou.is_active
      and user_can_view_operational_unit(ou.id)
  );
$$;

create or replace function user_can_manage_warehouse(p_warehouse_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select current_role_name() = 'full_access' or exists (
    select 1
    from operational_units ou
    where ou.warehouse_id = p_warehouse_id
      and ou.is_active
      and user_can_manage_operational_unit(ou.id)
  );
$$;

-- Broad read policies pre-date warehouse-only accounts. Keep those policies
-- for head-office roles, then explicitly expose only assigned operational
-- records below.
do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'accounts', 'company_settings', 'consignees', 'forex_rates',
    'suppliers', 'shipment_attachments', 'shipment_timeline',
    'demurrage_rates', 'cost_adjustments', 'customers',
    'sales_payments', 'credit_accounts', 'credit_transactions',
    'purchase_order_payments', 'containers', 'customs_declarations',
    'customs_line_items', 'demurrage_events', 'packing_lists', 'pi_items',
    'pl_items', 'proforma_invoices'
  ] loop
    if to_regclass('public.' || table_name) is not null then
      execute format('drop policy if exists "select_active_role" on %I', table_name);
      execute format(
        'create policy "select_active_role" on %I for select using (has_head_office_role())',
        table_name
      );
    end if;
  end loop;
end $$;

drop policy if exists "select_active_role" on companies;
create policy "select_active_role" on companies for select
using (has_head_office_role() and user_can_access_company(id));

drop policy if exists "select_active_role" on shipment_expenses;
create policy "select_active_role" on shipment_expenses for select
using (
  has_head_office_role() and exists (
    select 1 from shipments shipment
    where shipment.id = shipment_expenses.shipment_id
      and user_can_access_company(shipment.company_id)
  )
);

drop policy if exists "select_active_role" on sales_orders;
create policy "select_active_role" on sales_orders for select
using (has_head_office_role() and user_can_access_company(company_id));

drop policy if exists "select_active_role" on sales_order_lines;
create policy "select_active_role" on sales_order_lines for select
using (
  has_head_office_role() and exists (
    select 1 from sales_orders sales_order
    where sales_order.id = sales_order_lines.sales_order_id
      and user_can_access_company(sales_order.company_id)
  )
);

drop policy if exists "select_active_role" on purchase_orders;
create policy "select_active_role" on purchase_orders for select
using (has_head_office_role() and user_can_access_company(company_id));

drop policy if exists "select_active_role" on company_expenses;
create policy "select_active_role" on company_expenses for select
using (has_head_office_role() and user_can_access_company(company_id));

do $$
begin
  if to_regclass('public.supplier_payables') is not null then
    execute 'drop policy if exists "select_active_role" on supplier_payables';
    execute 'create policy "select_active_role" on supplier_payables for select using (has_head_office_role() and user_can_access_company(company_id))';
  end if;
  if to_regclass('public.supplier_payments') is not null then
    execute 'drop policy if exists "select_active_role" on supplier_payments';
    execute 'create policy "select_active_role" on supplier_payments for select using (has_head_office_role() and exists (select 1 from supplier_payables p where p.id=supplier_payments.payable_id and user_can_access_company(p.company_id)))';
  end if;
  if to_regclass('public.rfqs') is not null then
    execute 'drop policy if exists "select_active_role" on rfqs';
    execute 'create policy "select_active_role" on rfqs for select using (has_head_office_role() and user_can_access_company(company_id))';
  end if;
  if to_regclass('public.rfq_lines') is not null then
    execute 'drop policy if exists "select_active_role" on rfq_lines';
    execute 'create policy "select_active_role" on rfq_lines for select using (has_head_office_role() and exists (select 1 from rfqs r where r.id=rfq_lines.rfq_id and user_can_access_company(r.company_id)))';
  end if;
  if to_regclass('public.rfq_supplier_quotes') is not null then
    execute 'drop policy if exists "select_active_role" on rfq_supplier_quotes';
    execute 'create policy "select_active_role" on rfq_supplier_quotes for select using (has_head_office_role() and exists (select 1 from rfqs r where r.id=rfq_supplier_quotes.rfq_id and user_can_access_company(r.company_id)))';
  end if;
  if to_regclass('public.rfq_quote_lines') is not null then
    execute 'drop policy if exists "select_active_role" on rfq_quote_lines';
    execute 'create policy "select_active_role" on rfq_quote_lines for select using (has_head_office_role() and exists (select 1 from rfq_supplier_quotes q join rfqs r on r.id=q.rfq_id where q.id=rfq_quote_lines.rfq_supplier_quote_id and user_can_access_company(r.company_id)))';
  end if;
end $$;

drop policy if exists "select_active_role" on warehouses;
create policy "select_active_role" on warehouses for select
using (user_can_view_warehouse(id));

drop policy if exists "select_active_role" on inventory_ledger;
create policy "select_active_role" on inventory_ledger for select
using (user_can_view_warehouse(warehouse_id));

drop policy if exists "select_active_role" on warehouse_transfers;
create policy "select_active_role" on warehouse_transfers for select
using (
  has_head_office_role()
  or user_can_view_warehouse(from_warehouse_id)
  or (to_warehouse_id is not null and user_can_view_warehouse(to_warehouse_id))
);

drop policy if exists "select_active_role" on employees;
create policy "select_active_role" on employees for select
using (
  has_head_office_role()
  or (warehouse_id is not null and user_can_view_warehouse(warehouse_id))
);

drop policy if exists "select_active_role" on shipments;
create policy "select_active_role" on shipments for select
using (
  (has_head_office_role() and user_can_access_company(company_id))
  or (warehouse_id is not null and user_can_view_warehouse(warehouse_id))
);

drop policy if exists "select_active_role" on shipment_items;
create policy "select_active_role" on shipment_items for select
using (
  (has_head_office_role() and exists (
    select 1 from shipments shipment
    where shipment.id = shipment_items.shipment_id
      and user_can_access_company(shipment.company_id)
  ))
  or exists (
    select 1 from shipments shipment
    where shipment.id = shipment_items.shipment_id
      and shipment.warehouse_id is not null
      and user_can_view_warehouse(shipment.warehouse_id)
  )
);

-- Warehouse managers can record movements only for their own warehouse.
-- Existing department write policies remain unchanged and are OR-ed with
-- this narrowly-scoped policy.
drop policy if exists "warehouse_manager_insert_inventory" on inventory_ledger;
create policy "warehouse_manager_insert_inventory" on inventory_ledger for insert
with check (user_can_manage_warehouse(warehouse_id));

drop policy if exists "select_active_role" on damage_reports;
create policy "select_active_role" on damage_reports for select
using (
  has_head_office_role()
  or (warehouse_id is not null and user_can_view_warehouse(warehouse_id))
);

drop policy if exists "warehouse_manager_insert_damage_report" on damage_reports;
create policy "warehouse_manager_insert_damage_report" on damage_reports for insert
with check (warehouse_id is not null and user_can_manage_warehouse(warehouse_id));

revoke all on function has_head_office_role() from public;
revoke all on function user_can_view_warehouse(uuid) from public;
revoke all on function user_can_manage_warehouse(uuid) from public;
grant execute on function has_head_office_role() to authenticated;
grant execute on function user_can_view_warehouse(uuid) to authenticated;
grant execute on function user_can_manage_warehouse(uuid) to authenticated;

comment on function user_can_view_warehouse(uuid) is
  'Head-office roles can view all warehouses; warehouse_operations users only active assigned units.';
