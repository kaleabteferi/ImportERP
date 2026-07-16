-- Cascading shipment delete. Several child tables use RESTRICT/NO ACTION
-- (shipment_expenses, damage_reports, warehouse_transfers.linked_shipment_id,
-- cost_adjustments.shipment_item_id) so a plain DELETE FROM shipments fails
-- once any of those exist. inventory_ledger rows referencing a shipment are
-- a polymorphic reference (reference_type/reference_id), not a real FK, so
-- they're never cleaned up automatically and must be deleted explicitly or
-- they'd point at a shipment that no longer exists.
create or replace function delete_shipment_cascade(p_shipment_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_shipment_number text;
  v_deleted_items int;
  v_deleted_expenses int;
  v_deleted_transfers int;
  v_deleted_damage int;
  v_deleted_ledger int;
begin
  select shipment_number into v_shipment_number from shipments where id = p_shipment_id;
  if v_shipment_number is null then
    raise exception 'Shipment not found';
  end if;

  select count(*) into v_deleted_items from shipment_items where shipment_id = p_shipment_id;
  select count(*) into v_deleted_expenses from shipment_expenses where shipment_id = p_shipment_id;
  select count(*) into v_deleted_transfers from warehouse_transfers where linked_shipment_id = p_shipment_id;
  select count(*) into v_deleted_damage from damage_reports where shipment_id = p_shipment_id;
  select count(*) into v_deleted_ledger from inventory_ledger
    where (reference_type = 'shipment' and reference_id = p_shipment_id)
       or (reference_type = 'warehouse_transfer' and reference_id in (
             select id from warehouse_transfers where linked_shipment_id = p_shipment_id
           ));

  -- cost_adjustments blocks shipment_items' own cascade delete
  delete from cost_adjustments where shipment_item_id in (
    select id from shipment_items where shipment_id = p_shipment_id
  );

  delete from inventory_ledger
    where (reference_type = 'shipment' and reference_id = p_shipment_id)
       or (reference_type = 'warehouse_transfer' and reference_id in (
             select id from warehouse_transfers where linked_shipment_id = p_shipment_id
           ));

  delete from warehouse_transfers where linked_shipment_id = p_shipment_id;
  delete from damage_reports where shipment_id = p_shipment_id;
  delete from shipment_expenses where shipment_id = p_shipment_id;

  -- shipment_items, shipment_timeline, shipment_attachments, demurrage_rates
  -- cascade automatically; containers.shipment_id is SET NULL, not deleted.
  delete from shipments where id = p_shipment_id;

  return jsonb_build_object(
    'shipment_number', v_shipment_number,
    'deleted_items', v_deleted_items,
    'deleted_expenses', v_deleted_expenses,
    'deleted_transfers', v_deleted_transfers,
    'deleted_damage_reports', v_deleted_damage,
    'deleted_inventory_movements', v_deleted_ledger
  );
end;
$$;
