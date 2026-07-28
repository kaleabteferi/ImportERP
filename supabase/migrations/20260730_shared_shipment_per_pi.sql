-- Reverses part of the multi-container feature: containers used to each
-- spawn their own separate `shipments` row (1 container = 1 shipment). Now
-- one proforma_invoices order maps to exactly ONE shipment, with all its
-- containers sharing that shipment while staying independently trackable
-- (own arrival date, own demurrage/port-fee/WH window, own documents) via a
-- new `container_id` dimension on the per-shipment child tables.
--
-- Manual, PI-less shipment creation (src/pages/Shipments.tsx) remains a
-- live, separate code path -- those shipments have zero containers and
-- container_id stays NULL permanently for them, which is the correct
-- steady state, not a migration gap.

alter table shipment_items add column if not exists container_id uuid references containers(id) on delete restrict;
alter table shipment_timeline add column if not exists container_id uuid references containers(id) on delete restrict;
alter table demurrage_rates add column if not exists container_id uuid references containers(id) on delete restrict;

create index if not exists idx_shipment_items_container on shipment_items(container_id);
create index if not exists idx_shipment_timeline_container on shipment_timeline(container_id);
create index if not exists idx_demurrage_rates_container on demurrage_rates(container_id);

-- Backfill: every shipment with >=1 containers row today has EXACTLY one
-- (guaranteed by the 1:1 RPC that's existed until this migration, and by
-- the earlier one-time backfill). Unambiguous, non-destructive (only fills
-- a brand-new nullable column).
update shipment_items si set container_id = c.id
  from containers c where c.shipment_id = si.shipment_id and si.container_id is null;
update shipment_timeline st set container_id = c.id
  from containers c where c.shipment_id = st.shipment_id and st.container_id is null;
update demurrage_rates dr set container_id = c.id
  from containers c where c.shipment_id = dr.shipment_id and dr.container_id is null;

-- ── Constraint changes ──────────────────────────────────────────────────
-- shipment_items: old UNIQUE(shipment_id, product_id) blocks two sibling
-- containers under one shared shipment from both carrying the same
-- product. Replace with two partial indexes so manual (container-less)
-- shipments keep their exact current guarantee, while container-flow rows
-- get container-aware uniqueness.
alter table shipment_items drop constraint if exists shipment_items_unique;
create unique index if not exists shipment_items_unique_no_container
  on shipment_items(shipment_id, product_id) where container_id is null;
create unique index if not exists shipment_items_unique_per_container
  on shipment_items(shipment_id, container_id, product_id) where container_id is not null;

-- demurrage_rates / shipment_timeline are .upsert(onConflict:...) targets --
-- PostgREST can't target a partial index as an arbiter, and a plain
-- composite UNIQUE(shipment_id, container_id, ...) would stop working for
-- the container-less case (NULL <> NULL, so ON CONFLICT would never fire
-- and manual shipments would get duplicate rows instead of updates).
-- container_key collapses every "no container" row onto one real sentinel
-- value so onConflict keeps working for both cases. Pure dedup key, never
-- read directly elsewhere.
alter table demurrage_rates add column if not exists container_key uuid
  generated always as (coalesce(container_id, '00000000-0000-0000-0000-000000000000'::uuid)) stored;
alter table demurrage_rates drop constraint if exists demurrage_rates_shipment_id_key;
alter table demurrage_rates add constraint demurrage_rates_unique unique (shipment_id, container_key);

alter table shipment_timeline add column if not exists container_key uuid
  generated always as (coalesce(container_id, '00000000-0000-0000-0000-000000000000'::uuid)) stored;
alter table shipment_timeline drop constraint if exists shipment_timeline_shipment_id_event_type_key;
alter table shipment_timeline add constraint shipment_timeline_unique unique (shipment_id, container_key, event_type);

-- ── RPC redesign ────────────────────────────────────────────────────────
-- Was: 1 container -> 1 brand-new shipment, always. Now: the FIRST
-- container for a PI creates the one shared shipment; every sibling
-- container appends its own items into that SAME shipment (tagged with its
-- own container_id) instead of creating a new one. Still idempotent per
-- container (re-calling on an already-appended container is a no-op).
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

  select * into v_pi from proforma_invoices where id = v_container.pi_id for update;
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

  -- Row-locked the PI above, so this check is race-safe: if a sibling
  -- container already created the shared shipment, reuse it and don't
  -- touch any shipment-level column (those became a "first container"
  -- snapshot the moment a second container joined).
  select c.shipment_id into v_shipment_id
    from containers c where c.pi_id = v_container.pi_id and c.shipment_id is not null
    limit 1;

  if v_shipment_id is null then
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
  end if;

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
      shipment_id, container_id, product_id, quantity, unit_price_usd, unit_of_measure,
      units_per_carton, carton_qty, weight_kg_total, volume_m3_total,
      hs_code, country_of_origin, gross_weight_per_ctn, net_weight_per_ctn,
      length_cm, width_cm, height_cm, carton_marks, carton_number_from, carton_number_to,
      cost_status
    ) values (
      v_shipment_id, p_container_id, v_item.product_id, v_item.total_units, v_unit_price, v_item.unit_of_measure,
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
