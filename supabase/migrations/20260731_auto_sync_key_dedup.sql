-- Close a real check-then-act race in expenseSync.ts's upsertAutoExpense:
-- it SELECTs for an existing AUTO_SYNC row by `notes LIKE 'tag%'`, then
-- INSERTs if not found -- two near-simultaneous callers (e.g. the
-- auto-sync effect in TimelinePanel racing a manual "Sync now" click, or
-- rapid container-tab switching remounting it) can both see "not found"
-- and both insert, producing duplicate expense rows. A shipment with more
-- containers mounts/remounts TimelinePanel more often as the user switches
-- tabs, so the odds of hitting this scale with container count -- matching
-- the "expenses come out 2x/3x with more containers" symptom reported.
--
-- Fix: a real, indexed key column plus a DB-level unique constraint, so the
-- write becomes one atomic upsert instead of a SELECT-then-INSERT round trip.
alter table shipment_expenses add column if not exists auto_sync_key text;

-- Backfill from the existing notes tag (everything before the first '|'
-- detail separator) for rows already written under the old scheme.
update shipment_expenses
set auto_sync_key = split_part(notes, '|', 1)
where notes like 'AUTO_SYNC:%' and auto_sync_key is null;

-- Not partial: NULL auto_sync_key (every manually-entered expense) is
-- already exempt from uniqueness on its own -- SQL treats each NULL as
-- distinct from every other NULL, so manual expenses never collide here
-- regardless of how many share a shipment_id. A partial index would also
-- break `.upsert(..., { onConflict: 'shipment_id,auto_sync_key' })` from
-- supabase-js, which can't express the partial predicate in its ON
-- CONFLICT target.
create unique index if not exists shipment_expenses_auto_sync_key_unique
  on shipment_expenses (shipment_id, auto_sync_key);
