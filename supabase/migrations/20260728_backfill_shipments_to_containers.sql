-- One-time backfill: every pre-existing shipment gets exactly one matching
-- proforma_invoices row and one containers row (linked via
-- containers.shipment_id), so old data behaves like "one order, one
-- container" under the new model with zero manual re-entry. Existing
-- shipments/shipment_items are never touched -- they stay authoritative;
-- the container row's only job is to make containers.shipment_id a
-- complete mirror so future container-aware UI doesn't show old shipments
-- as orphans. Guarded by a NOT EXISTS check so it's safe to re-run.
--
-- pi_items/packing_lists/pl_items are deliberately NOT backfilled -- there's
-- no historical per-container item split to reconstruct, only the shipment
-- <-> container linkage needs to exist.
do $$
declare
  v_shipment record;
  v_pi_id uuid;
  v_container_number text;
begin
  for v_shipment in
    select s.* from shipments s
    where not exists (select 1 from containers c where c.shipment_id = s.id)
  loop
    insert into proforma_invoices (
      pi_number, supplier_id, issue_date, currency, incoterm, port_of_loading,
      payment_terms, status, buyer_company_id, final_company_id, notes
    ) values (
      'BACKFILL-' || v_shipment.shipment_number,
      v_shipment.supplier_id,
      v_shipment.created_at::date,
      'USD',
      coalesce(v_shipment.incoterm, 'FOB'),
      v_shipment.port_of_loading,
      v_shipment.payment_terms,
      'DRAFT',
      v_shipment.company_id,
      v_shipment.company_id,
      'Auto-migrated from shipment ' || v_shipment.shipment_number
    ) returning id into v_pi_id;

    v_container_number := coalesce(v_shipment.container_number, 'UNKNOWN-' || v_shipment.shipment_number);

    insert into containers (
      container_number, pi_id, shipment_id, vessel_name, bl_number,
      voyage_number, eta_djibouti, status
    ) values (
      v_container_number, v_pi_id, v_shipment.id, v_shipment.vessel_name, v_shipment.bl_number,
      v_shipment.voyage_number, v_shipment.eta_djibouti, v_shipment.status
    );
  end loop;
end $$;

-- Verify: should return 0 rows.
-- select count(*) from shipments s where not exists (select 1 from containers c where c.shipment_id = s.id);
