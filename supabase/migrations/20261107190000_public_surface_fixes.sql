-- T-04 follow-up (#12): review-round fixes to the public surface of the core schema. A forward migration;
-- 20261107170000_core_schema.sql is already applied and stays as merged.
--
--   1. No ordering leaks (locked principle 5): the public views return rows ordered by a hash, never in
--      insertion order. No public-readable column is a sequence, identity or cast/event timestamp
--      (ids are random v4 uuids from gen_random_uuid()).
--   2. ballot_event_public runs as the caller (security_invoker), so the base-table column grants and
--      RLS decide what the public reads. Its date now comes from a stored generated column, which the
--      public may read in place of occurred_at.
--   3. Event hashes (prev_hash, hash) are public, so anyone can recompute each ballot's hash chain
--      (locked principle 2). The hash input must therefore hold only publicly readable fields: the date,
--      never occurred_at or recorded_at, or the time of day could be brute-forced from the hash.
--   8. stage_records is insert-only, so publishing is the insert: published_at is set then, never later.

-- ---------------------------------------------------------------------------------------------------
-- 8. Publishing a stage record is an insert. Fails loudly if a draft (null published_at) row exists:
-- insert-only rows cannot be backfilled, so such a row needs a human decision, not a silent update.
-- ---------------------------------------------------------------------------------------------------

alter table public.stage_records alter column published_at set default now();
alter table public.stage_records alter column published_at set not null;

drop policy stage_records_public_read on public.stage_records;
create policy stage_records_public_read on public.stage_records for select to anon, authenticated
  using (published_at <= now());

-- ---------------------------------------------------------------------------------------------------
-- 2. The public event date, as a column the public may read.
--
-- Dates are in Indiana election-office time (America/Indiana/Indianapolis) because the demo
-- jurisdiction is Indiana. A later ticket makes the jurisdiction's time zone configuration; until then
-- this literal is the one place it is set. timezone(text, timestamptz) is immutable, so the column can
-- be generated and stored. Adding it rewrites the table without firing the insert-only row triggers.
-- ---------------------------------------------------------------------------------------------------

alter table public.ballot_events
  add column occurred_on date
  generated always as ((occurred_at at time zone 'America/Indiana/Indianapolis')::date) stored;

-- 2 and 3: the public reads these columns too. occurred_at, recorded_at, actor_id, batch_id and
-- nist_event_code stay private.
grant select (occurred_on, prev_hash, hash) on public.ballot_events to anon, authenticated;

-- ---------------------------------------------------------------------------------------------------
-- Public views, recreated. Both run as the caller, so the grants above (and RLS) apply, and both are
-- security_barrier so caller-supplied filters cannot see rows or columns the view hides.
-- Output is ordered by a SHA-256 hash (id breaks ties), a non-temporal key: a bulk read never comes
-- back in cast order.
-- ---------------------------------------------------------------------------------------------------

drop view public.ballot_event_public;
drop view public.ballot_public;

create view public.ballot_public
with (security_invoker = true, security_barrier = true)
as
select id, tracking_code, ciphertext_hash, precinct_id, cast_date, current_status
from public.ballots
order by ciphertext_hash, id;

create view public.ballot_event_public
with (security_invoker = true, security_barrier = true)
as
select
  id,
  ballot_id,
  precinct_id,
  county_id,
  event_type,
  from_status,
  to_status,
  reason,
  occurred_on,
  prev_hash,
  hash
from public.ballot_events
order by hash, id;

revoke all on public.ballot_public, public.ballot_event_public from public, anon, authenticated, service_role;
grant select on public.ballot_public, public.ballot_event_public to anon, authenticated, service_role;
