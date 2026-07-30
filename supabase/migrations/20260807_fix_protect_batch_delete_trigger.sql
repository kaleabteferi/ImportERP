-- protect_approved_production_batch() is a BEFORE DELETE OR UPDATE trigger
-- that unconditionally did `return new`. On DELETE, `new` is always NULL,
-- and a BEFORE DELETE trigger returning NULL silently cancels the delete
-- for that row (no error) — so no production_batches row could ever be
-- deleted, draft or not. Return `old` on DELETE instead.

create or replace function protect_approved_production_batch()
returns trigger language plpgsql security definer set search_path=public as $$
begin
  if old.status='approved' and not user_can_approve_operational_unit(old.operational_unit_id) then
    raise exception 'Approved production batches are immutable';
  end if;
  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end; $$;
