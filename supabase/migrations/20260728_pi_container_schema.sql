-- Multi-container orders + ALPHA intermediary company.
--
-- Context: proforma_invoices -> pi_items / containers -> packing_lists ->
-- pl_items (plus customs_declarations/customs_line_items, consignees,
-- demurrage_events) already exist live in this project with full FKs,
-- indexes, and unique constraints in place (confirmed via pg_constraint /
-- pg_indexes) -- a prior, unfinished pass at this exact feature, built
-- directly via the Supabase dashboard with no tracked migration. Nothing
-- here recreates that structure. This migration adds only what's actually
-- missing: the ALPHA buyer/final-company/markup columns on
-- proforma_invoices, the ALPHA company row, and the RPC that bridges a
-- packed container into the existing shipments pipeline. Cost allocation,
-- demurrage (TimelinePanel), customs (CustomsTab), inventory receive,
-- Djibouti forwarder, and shipment documents are all untouched by this
-- migration -- they only ever key off shipment_id/shipment_item_id, and the
-- RPC below is the one place that bridges into them.

-- ALPHA acts as buyer-of-record with the real overseas supplier, then
-- resells to whichever of the business's other companies actually needs the
-- stock (decided after the goods reach Djibouti). markup_pct bakes ALPHA's
-- resale margin into the destination company's landed cost at shipment
-- generation time -- no separate inter-company ledger entries this phase.
alter table proforma_invoices add column if not exists buyer_company_id uuid references companies(id);
alter table proforma_invoices add column if not exists final_company_id uuid references companies(id);
alter table proforma_invoices add column if not exists markup_pct numeric;

insert into companies (name, is_active)
values ('ALPHA', true)
on conflict (name) do nothing;

-- Generates a shipment (and its shipment_items) from a packed container.
-- Idempotent: calling it again on an already-generated container just
-- returns the existing shipment id instead of creating a duplicate.
create or replace function create_shipment_from_container(p_container_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_container containers%rowtype;
  v_pi proforma_invoices%rowtype;
  v_pl packing_lists%rowtype;
  v_shipment_id uuid;
  v_shipment_number text;
  v_year int := extract(year from now())::int;
  v_count int;
  v_item record;
  v_unit_price numeric;
begin
  select * into v_container from containers where id = p_container_id;
  if v_container.id is null then
    raise exception 'Container not found';
  end if;

  if v_container.shipment_id is not null then
    return v_container.shipment_id;
  end if;

  select * into v_pi from proforma_invoices where id = v_container.pi_id;
  if v_pi.id is null then
    raise exception 'Parent proforma invoice not found';
  end if;

  select * into v_pl from packing_lists where container_id = p_container_id;
  if v_pl.id is null then
    raise exception 'Container has no packing list yet -- split items onto it before generating a shipment';
  end if;

  if not exists (select 1 from pl_items where pl_id = v_pl.id) then
    raise exception 'Packing list has no line items yet';
  end if;

  if exists (
    select 1 from pl_items pli
    join pi_items pii on pii.id = pli.pi_item_id
    where pli.pl_id = v_pl.id and pii.product_id is null
  ) then
    raise exception 'Every line item must be linked to a product before generating a shipment';
  end if;

  -- shipment_number: same "SHP-<year>-<seq>" convention as the manual create
  -- flow in src/pages/Shipments.tsx, generated server-side with a retry loop
  -- instead of the client's retry-on-conflict loop.
  for attempt in 1..5 loop
    select count(*) into v_count from shipments
      where created_at >= make_date(v_year,1,1) and created_at < make_date(v_year+1,1,1);
    v_shipment_number := 'SHP-' || v_year || '-' || lpad((v_count + attempt)::text, 3, '0');

    begin
      insert into shipments (
        shipment_number, container_number, supplier_id, company_id,
        vessel_name, bl_number, voyage_number, eta_djibouti,
        port_of_loading, incoterm, payment_terms, status, allocation_method
      ) values (
        v_shipment_number, v_container.container_number, v_pi.supplier_id, v_pi.final_company_id,
        v_container.vessel_name, v_container.bl_number, v_container.voyage_number, v_container.eta_djibouti,
        v_pi.port_of_loading, v_pi.incoterm, v_pi.payment_terms, v_container.status, 'QUANTITY'
      ) returning id into v_shipment_id;
      exit;
    exception when unique_violation then
      if attempt = 5 then
        raise;
      end if;
    end;
  end loop;

  for v_item in
    select pli.*, pii.product_id, pii.unit_price, pii.unit_of_measure, pii.hs_code, pii.country_of_origin
    from pl_items pli
    join pi_items pii on pii.id = pli.pi_item_id
    where pli.pl_id = v_pl.id
  loop
    v_unit_price := v_item.unit_price;
    if v_pi.markup_pct is not null and v_pi.buyer_company_id is not null
       and v_pi.buyer_company_id <> v_pi.final_company_id then
      v_unit_price := v_unit_price * (1 + v_pi.markup_pct / 100.0);
    end if;

    insert into shipment_items (
      shipment_id, product_id, quantity, unit_price_usd, unit_of_measure,
      units_per_carton, carton_qty, weight_kg_total, volume_m3_total,
      hs_code, country_of_origin, gross_weight_per_ctn, net_weight_per_ctn,
      length_cm, width_cm, height_cm, carton_marks, carton_number_from, carton_number_to,
      cost_status
    ) values (
      v_shipment_id, v_item.product_id, v_item.total_units, v_unit_price, v_item.unit_of_measure,
      v_item.units_per_carton, v_item.carton_qty, v_item.total_gross_kg, v_item.total_volume_m3,
      v_item.hs_code, v_item.country_of_origin, v_item.gross_weight_per_ctn, v_item.net_weight_per_ctn,
      v_item.length_cm, v_item.width_cm, v_item.height_cm, v_item.marks_and_numbers,
      v_item.carton_number_from, v_item.carton_number_to,
      'PROVISIONAL'
    );
  end loop;

  update containers set shipment_id = v_shipment_id, updated_at = now() where id = p_container_id;

  return v_shipment_id;
end;
$$;
