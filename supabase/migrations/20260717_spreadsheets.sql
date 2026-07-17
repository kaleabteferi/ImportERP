-- Saved calculator/spreadsheet sheets. Personal scratch tool — each user
-- sees and edits only their own sheets; full_access can see everyone's
-- (consistent with its "always passes every check" role elsewhere).
create table if not exists spreadsheets (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references profiles(id) on delete cascade,
  name text not null default 'Untitled sheet',
  data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table spreadsheets enable row level security;

create policy "own_sheets_select" on spreadsheets for select
  using (owner_id = auth.uid() or has_full_access());
create policy "own_sheets_write" on spreadsheets for all
  using (owner_id = auth.uid() or has_full_access())
  with check (owner_id = auth.uid() or has_full_access());

create or replace function touch_spreadsheet_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_touch_spreadsheet on spreadsheets;
create trigger trg_touch_spreadsheet
  before update on spreadsheets
  for each row execute function touch_spreadsheet_updated_at();
