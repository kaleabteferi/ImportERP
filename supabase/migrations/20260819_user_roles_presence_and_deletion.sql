-- Canonical roles, safe logical deletion and lightweight online presence.

alter table profiles add column if not exists is_active boolean not null default true;

do $$
declare constraint_row record;
begin
  for constraint_row in
    select conname
    from pg_constraint
    where conrelid = 'public.profiles'::regclass
      and contype = 'c'
      and pg_get_constraintdef(oid) ~* '\mrole\M'
  loop
    execute format('alter table profiles drop constraint %I', constraint_row.conname);
  end loop;
end $$;

alter table profiles add constraint profiles_role_check check (role in (
  'pending', 'full_access', 'accounting_finance', 'operations_marketing',
  'manufacturing_sales', 'hr_system', 'warehouse_operations'
));

create table if not exists user_presence (
  profile_id uuid primary key references profiles(id) on delete cascade,
  last_seen_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table user_presence enable row level security;

drop policy if exists "presence_own_write" on user_presence;
create policy "presence_own_write" on user_presence for insert
with check (profile_id = auth.uid());
drop policy if exists "presence_own_update" on user_presence;
create policy "presence_own_update" on user_presence for update
using (profile_id = auth.uid()) with check (profile_id = auth.uid());
drop policy if exists "presence_admin_read" on user_presence;
create policy "presence_admin_read" on user_presence for select
using (current_role_name() in ('full_access', 'hr_system'));

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'user_presence'
  ) then
    alter publication supabase_realtime add table user_presence;
  end if;
end $$;

create index if not exists idx_user_presence_recent on user_presence(last_seen_at desc);
