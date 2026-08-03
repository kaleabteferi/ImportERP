-- Shared document lifecycle, material intelligence, work inbox, notifications
-- and immutable audit history for the cross-module ERP command center.

alter table products add column if not exists material_kind text not null default 'finished_product';
alter table products add column if not exists hs_code text;
alter table products add column if not exists origin_country text;
alter table products add column if not exists model_number text;
alter table products add column if not exists specification text;
alter table products add column if not exists pack_uom text default 'CTN';
alter table products add column if not exists units_per_pack numeric(14,4);
alter table products add column if not exists net_weight_kg numeric(14,4);
alter table products add column if not exists gross_weight_kg numeric(14,4);
alter table products add column if not exists carton_cbm numeric(14,6);
alter table products add column if not exists customs_description text;
alter table products add column if not exists declared_unit_value_usd numeric(14,4);
alter table products add column if not exists assessed_unit_value_usd numeric(14,4);

do $$ begin
  alter table products add constraint products_material_kind_check check (material_kind in (
    'finished_product','skd_component','packaging_material','spare_part','raw_material'
  ));
exception when duplicate_object then null; end $$;

create table if not exists erp_documents (
  id uuid primary key default gen_random_uuid(),
  document_number text not null unique,
  document_type text not null check (document_type in (
    'proforma_invoice','purchase_order','packing_list','container_plan','customs_declaration',
    'goods_receipt','warehouse_transfer','production_order','finished_goods_receipt',
    'sales_order','delivery_note','sales_invoice','payroll_journal'
  )),
  status text not null default 'draft' check (status in ('draft','submitted','approved','rejected','posted','cancelled')),
  title text,
  issue_date date not null default current_date,
  counterparty_name text,
  currency text not null default 'USD',
  subtotal numeric(16,2) not null default 0,
  total_amount numeric(16,2) not null default 0,
  source_operational_unit_id uuid references operational_units(id),
  destination_operational_unit_id uuid references operational_units(id),
  external_reference text,
  source_table text,
  source_record_id uuid,
  notes text,
  metadata jsonb not null default '{}'::jsonb,
  created_by uuid default auth.uid() references profiles(id),
  approved_by uuid references profiles(id),
  approved_at timestamptz,
  posted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists erp_document_lines (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references erp_documents(id) on delete cascade,
  line_number integer not null,
  product_id uuid references products(id),
  description text not null,
  material_kind text not null default 'finished_product',
  hs_code text,
  origin_country text,
  model_number text,
  specification text,
  quantity numeric(16,4) not null default 0,
  uom text not null default 'PCS',
  pack_count numeric(16,4),
  pack_uom text default 'CTN',
  units_per_pack numeric(16,4),
  unit_price numeric(16,4) not null default 0,
  declared_unit_value numeric(16,4),
  assessed_unit_value numeric(16,4),
  net_weight_kg numeric(16,4),
  gross_weight_kg numeric(16,4),
  carton_length_cm numeric(12,2),
  carton_width_cm numeric(12,2),
  carton_height_cm numeric(12,2),
  cbm numeric(16,6),
  bom_quantity_per_finished numeric(16,4),
  accepted_quantity numeric(16,4),
  rejected_quantity numeric(16,4),
  notes text,
  created_at timestamptz not null default now(),
  unique(document_id, line_number)
);

create table if not exists erp_document_relations (
  id uuid primary key default gen_random_uuid(),
  source_document_id uuid not null references erp_documents(id) on delete cascade,
  target_document_id uuid not null references erp_documents(id) on delete cascade,
  relation_type text not null default 'generated_from',
  created_by uuid default auth.uid() references profiles(id),
  created_at timestamptz not null default now(),
  unique(source_document_id,target_document_id,relation_type)
);

create table if not exists erp_document_events (
  id bigint generated always as identity primary key,
  document_id uuid not null references erp_documents(id) on delete cascade,
  event_type text not null,
  from_status text,
  to_status text,
  note text,
  actor_id uuid default auth.uid() references profiles(id),
  created_at timestamptz not null default now()
);

create table if not exists audit_events (
  id bigint generated always as identity primary key,
  actor_id uuid default auth.uid() references profiles(id),
  action text not null,
  entity_type text not null,
  entity_id text not null,
  summary text not null,
  previous_values jsonb,
  new_values jsonb,
  context jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists work_items (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  description text,
  work_type text not null default 'task',
  priority text not null default 'medium' check (priority in ('low','medium','high','critical')),
  status text not null default 'open' check (status in ('open','in_progress','blocked','done','cancelled')),
  assigned_profile_id uuid references profiles(id),
  assigned_role text,
  operational_unit_id uuid references operational_units(id),
  entity_type text,
  entity_id text,
  action_url text,
  due_at timestamptz,
  created_by uuid default auth.uid() references profiles(id),
  completed_by uuid references profiles(id),
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists app_notifications (
  id uuid primary key default gen_random_uuid(),
  recipient_profile_id uuid references profiles(id) on delete cascade,
  recipient_role text,
  operational_unit_id uuid references operational_units(id),
  category text not null default 'system',
  severity text not null default 'info' check (severity in ('info','success','warning','critical')),
  title text not null,
  message text,
  action_label text,
  action_url text,
  entity_type text,
  entity_id text,
  read_at timestamptz,
  dismissed_at timestamptz,
  created_at timestamptz not null default now()
);

create or replace function can_access_erp_unit(p_unit_id uuid)
returns boolean language sql stable security definer set search_path=public as $$
  select (p_unit_id is null and current_role_name() in ('full_access','accounting_finance','operations_marketing','manufacturing_sales','hr_system'))
    or current_role_name() in ('full_access','accounting_finance','operations_marketing','manufacturing_sales','hr_system')
    or exists (
      select 1 from warehouse_user_assignments a
      where a.profile_id=auth.uid() and a.operational_unit_id=p_unit_id and a.is_active=true
        and (a.effective_from is null or a.effective_from<=current_date)
        and (a.effective_to is null or a.effective_to>=current_date)
    )
$$;

create or replace function capture_erp_document_change()
returns trigger language plpgsql security definer set search_path=public as $$
begin
  new.updated_at=now();
  if tg_op='UPDATE' and old.status is distinct from new.status then
    insert into erp_document_events(document_id,event_type,from_status,to_status,actor_id)
    values(new.id,'status_changed',old.status,new.status,auth.uid());
    insert into audit_events(actor_id,action,entity_type,entity_id,summary,previous_values,new_values)
    values(auth.uid(),'status_changed','erp_document',new.id::text,
      new.document_number||' changed from '||old.status||' to '||new.status,
      jsonb_build_object('status',old.status),jsonb_build_object('status',new.status));
  end if;
  return new;
end $$;
drop trigger if exists trg_capture_erp_document_change on erp_documents;
create trigger trg_capture_erp_document_change before update on erp_documents
for each row execute function capture_erp_document_change();

create or replace function create_document_work_item()
returns trigger language plpgsql security definer set search_path=public as $$
begin
  if new.status='submitted' and old.status is distinct from new.status then
    insert into work_items(title,description,work_type,priority,assigned_role,operational_unit_id,entity_type,entity_id,action_url)
    values('Review '||new.document_number,coalesce(new.title,new.document_type),'approval','high',
      case when new.document_type in ('payroll_journal','sales_invoice') then 'accounting_finance' else 'operations_marketing' end,
      coalesce(new.destination_operational_unit_id,new.source_operational_unit_id),'erp_document',new.id::text,'/documents/'||new.id);
    insert into app_notifications(recipient_role,operational_unit_id,category,severity,title,message,action_label,action_url,entity_type,entity_id)
    values(case when new.document_type in ('payroll_journal','sales_invoice') then 'accounting_finance' else 'operations_marketing' end,
      coalesce(new.destination_operational_unit_id,new.source_operational_unit_id),'approval','warning','Document awaiting approval',
      new.document_number||' is ready for review.','Review document','/documents','erp_document',new.id::text);
  end if;
  return new;
end $$;
drop trigger if exists trg_create_document_work_item on erp_documents;
create trigger trg_create_document_work_item after update on erp_documents
for each row execute function create_document_work_item();

create unique index if not exists uq_erp_documents_source on erp_documents(source_table,source_record_id)
where source_table is not null and source_record_id is not null;

create or replace function sync_source_record_to_erp_document()
returns trigger language plpgsql security definer set search_path=public as $$
declare row_data jsonb:=to_jsonb(new); mapped_type text; mapped_number text; mapped_status text; source_id uuid;
begin
  source_id=(row_data->>'id')::uuid;
  mapped_type=case tg_table_name
    when 'proforma_invoices' then 'proforma_invoice'
    when 'warehouse_transfers' then 'warehouse_transfer'
    when 'production_batches' then 'production_order'
    when 'warehouse_payroll_runs' then 'payroll_journal'
    when 'sales_orders' then 'sales_order'
  end;
  if mapped_type is null then return new; end if;
  mapped_number=coalesce(row_data->>'pi_number',row_data->>'transfer_number',row_data->>'batch_number',row_data->>'run_number',row_data->>'order_number',upper(left(mapped_type,3))||'-'||left(source_id::text,8));
  mapped_status=case lower(coalesce(row_data->>'status','draft'))
    when 'draft' then 'draft' when 'rejected' then 'rejected' when 'cancelled' then 'cancelled'
    when 'approved' then 'approved' when 'hr_approved' then 'approved' when 'finance_approved' then 'approved'
    when 'posted' then 'posted' when 'paid' then 'posted' when 'received' then 'posted' when 'completed' then 'posted'
    else 'submitted' end;
  insert into erp_documents(document_number,document_type,status,title,issue_date,currency,total_amount,external_reference,source_table,source_record_id,metadata,created_by)
  values(mapped_number,mapped_type,mapped_status,replace(mapped_type,'_',' '),
    coalesce((row_data->>'issue_date')::date,(row_data->>'transfer_date')::date,(row_data->>'period_end')::date,current_date),
    coalesce(row_data->>'currency','ETB'),coalesce((row_data->>'total_amount')::numeric,(row_data->>'net_amount')::numeric,0),
    mapped_number,tg_table_name,source_id,jsonb_build_object('source_status',row_data->>'status'),auth.uid())
  on conflict(source_table,source_record_id) where source_table is not null and source_record_id is not null
  do update set document_number=excluded.document_number,status=excluded.status,total_amount=excluded.total_amount,metadata=excluded.metadata,updated_at=now();
  return new;
exception when invalid_text_representation then
  return new;
end $$;

do $$ declare source_table_name text;
begin
  foreach source_table_name in array array['proforma_invoices','warehouse_transfers','production_batches','warehouse_payroll_runs','sales_orders'] loop
    if to_regclass('public.'||source_table_name) is not null then
      execute format('drop trigger if exists trg_sync_erp_document on %I',source_table_name);
      execute format('create trigger trg_sync_erp_document after insert or update on %I for each row execute function sync_source_record_to_erp_document()',source_table_name);
    end if;
  end loop;
end $$;

create or replace function capture_sensitive_row_change()
returns trigger language plpgsql security definer set search_path=public as $$
declare old_row jsonb; new_row jsonb; record_id text;
begin
  old_row=case when tg_op in ('UPDATE','DELETE') then to_jsonb(old) else null end;
  new_row=case when tg_op in ('INSERT','UPDATE') then to_jsonb(new) else null end;
  record_id=coalesce(new_row->>'id',old_row->>'id','unknown');
  insert into audit_events(actor_id,action,entity_type,entity_id,summary,previous_values,new_values)
  values(auth.uid(),lower(tg_op),tg_table_name,record_id,
    replace(tg_table_name,'_',' ')||' '||lower(tg_op)||' recorded',old_row,new_row);
  return case when tg_op='DELETE' then old else new end;
end $$;

do $$ declare table_name text;
begin
  foreach table_name in array array['warehouse_user_assignments','warehouse_transfers','production_batches','warehouse_payroll_runs'] loop
    if to_regclass('public.'||table_name) is not null then
      execute format('drop trigger if exists trg_audit_sensitive_change on %I',table_name);
      execute format('create trigger trg_audit_sensitive_change after insert or update or delete on %I for each row execute function capture_sensitive_row_change()',table_name);
    end if;
  end loop;
end $$;

create or replace function bridge_operational_alert_notification()
returns trigger language plpgsql security definer set search_path=public as $$
begin
  insert into app_notifications(recipient_role,operational_unit_id,category,severity,title,message,action_label,action_url,entity_type,entity_id)
  values('warehouse_operations',new.operational_unit_id,'warehouse',
    case when new.severity in ('high','critical') then 'critical' when new.severity='medium' then 'warning' else 'info' end,
    new.title,new.message,'Open warehouse','/warehouse-operations','operational_alert',new.id::text);
  return new;
end $$;
do $$ begin
  if to_regclass('public.operational_alerts') is not null then
    drop trigger if exists trg_bridge_operational_alert_notification on operational_alerts;
    create trigger trg_bridge_operational_alert_notification after insert on operational_alerts
    for each row execute function bridge_operational_alert_notification();
  end if;
end $$;

alter table erp_documents enable row level security;
alter table erp_document_lines enable row level security;
alter table erp_document_relations enable row level security;
alter table erp_document_events enable row level security;
alter table audit_events enable row level security;
alter table work_items enable row level security;
alter table app_notifications enable row level security;

drop policy if exists erp_documents_access on erp_documents;
create policy erp_documents_access on erp_documents for all using (
  current_role_name()<>'pending' and (created_by=auth.uid() or can_access_erp_unit(coalesce(destination_operational_unit_id,source_operational_unit_id)))
) with check (current_role_name()<>'pending' and (created_by=auth.uid() or can_access_erp_unit(coalesce(destination_operational_unit_id,source_operational_unit_id))));
drop policy if exists erp_document_lines_access on erp_document_lines;
create policy erp_document_lines_access on erp_document_lines for all using (
  exists(select 1 from erp_documents d where d.id=document_id)
) with check (exists(select 1 from erp_documents d where d.id=document_id));
drop policy if exists erp_document_relations_access on erp_document_relations;
create policy erp_document_relations_access on erp_document_relations for all using (
  exists(select 1 from erp_documents d where d.id=source_document_id)
) with check (exists(select 1 from erp_documents d where d.id=source_document_id));
drop policy if exists erp_document_events_read on erp_document_events;
create policy erp_document_events_read on erp_document_events for select using (
  exists(select 1 from erp_documents d where d.id=document_id)
);
drop policy if exists audit_events_insert on audit_events;
create policy audit_events_insert on audit_events for insert with check (auth.uid() is not null);
drop policy if exists audit_events_read on audit_events;
create policy audit_events_read on audit_events for select using (
  actor_id=auth.uid() or current_role_name() in ('full_access','accounting_finance','hr_system')
);
drop policy if exists work_items_access on work_items;
create policy work_items_access on work_items for all using (
  assigned_profile_id=auth.uid() or (assigned_role=current_role_name() and can_access_erp_unit(operational_unit_id))
  or created_by=auth.uid() or current_role_name()='full_access'
) with check (current_role_name()<>'pending');
drop policy if exists notifications_read on app_notifications;
create policy notifications_read on app_notifications for select using (
  recipient_profile_id=auth.uid() or (recipient_role=current_role_name() and can_access_erp_unit(operational_unit_id)) or current_role_name()='full_access'
);
drop policy if exists notifications_update on app_notifications;
create policy notifications_update on app_notifications for update using (
  recipient_profile_id=auth.uid() or (recipient_role=current_role_name() and can_access_erp_unit(operational_unit_id)) or current_role_name()='full_access'
) with check (recipient_profile_id=auth.uid() or (recipient_role=current_role_name() and can_access_erp_unit(operational_unit_id)) or current_role_name()='full_access');
drop policy if exists notifications_insert on app_notifications;
create policy notifications_insert on app_notifications for insert with check (current_role_name()<>'pending');

create index if not exists idx_erp_documents_type_status on erp_documents(document_type,status,issue_date desc);
create index if not exists idx_erp_document_lines_product on erp_document_lines(product_id);
create index if not exists idx_work_items_assignee on work_items(assigned_profile_id,assigned_role,status,due_at);
create index if not exists idx_notifications_recipient on app_notifications(recipient_profile_id,recipient_role,read_at,created_at desc);
create index if not exists idx_audit_events_entity on audit_events(entity_type,entity_id,created_at desc);

do $$ begin
  if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='app_notifications') then
    alter publication supabase_realtime add table app_notifications;
  end if;
end $$;
