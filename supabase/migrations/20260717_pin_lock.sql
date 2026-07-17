-- PIN lock: a bank-app-style relock layer on top of Supabase Auth. The PIN
-- hash is never exposed to the client (profiles is normally selected with
-- an explicit column list that excludes it) — all reads/writes go through
-- SECURITY DEFINER RPCs scoped to auth.uid(), so no RLS policy on profiles
-- needs to grant pin_hash access at all.

alter table profiles add column if not exists pin_hash text;

create or replace function has_pin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select pin_hash is not null from profiles where id = auth.uid();
$$;

create or replace function set_pin(p_pin text)
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;
  if p_pin !~ '^[0-9]{4}$' then
    raise exception 'PIN must be exactly 4 digits';
  end if;
  update profiles set pin_hash = crypt(p_pin, gen_salt('bf')) where id = auth.uid();
end;
$$;

create or replace function verify_pin(p_pin text)
returns boolean
language sql
stable
security definer
set search_path = public, extensions
as $$
  select pin_hash is not null and pin_hash = crypt(p_pin, pin_hash)
  from profiles where id = auth.uid();
$$;

create or replace function clear_pin()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;
  update profiles set pin_hash = null where id = auth.uid();
end;
$$;
