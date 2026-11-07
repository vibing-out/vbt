-- T-04 core schema: the data model from docs/locked-interfaces.md ("Event schema", "Data model").
--
-- Access model (T-04; official role policies arrive with sign-in in T-20):
--   * anon / authenticated read only safe columns: tracking codes, ciphertext hashes, statuses, dates,
--     and published stage records. Ciphertext and event timestamps are withheld by column grants, so
--     RLS is not the only guard. The views ballot_public and ballot_event_public are the public surface.
--   * service_role (server code) is the only writer. On ballots it may update only current_status and
--     mismatch; everything else in a ballot row is fixed at insert.
--   * ballot_events and stage_records are insert-only for everyone, the table owner included.
--
-- Status and scope values mirror @vbt/domain BALLOT_STATUSES and BATCH_SCOPES exactly
-- (supabase/tests checks this). The transition rules stay in packages/domain, not in triggers.
--
-- No column holds voter identity (name, voter ID, date of birth, voter signature, contact details).

-- ---------------------------------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------------------------------

create function public.reject_mutation() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception '% is insert-only: % is not allowed', tg_table_name, tg_op
    using errcode = 'insufficient_privilege';
end;
$$;

revoke all on function public.reject_mutation() from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------------------------------

create table public.precincts (
  id text primary key,
  county_id text not null,
  name text not null
);

create table public.machines (
  id text primary key,
  precinct_id text not null references public.precincts (id),
  vendor text not null,
  model text not null,
  public_key text not null
);

create table public.ballots (
  id uuid primary key default gen_random_uuid(),
  tracking_code text not null unique,
  prev_tracking_code text,
  ciphertext text not null,
  ciphertext_hash text not null,
  ballot_style text not null,
  precinct_id text not null references public.precincts (id),
  machine_id text not null references public.machines (id),
  cast_date date not null,
  current_status text not null default 'CAST',
  mismatch boolean not null default false,
  constraint ballots_current_status_check check (current_status in (
    'CAST', 'TALLIED_PRECINCT', 'REPORTED_UNOFFICIAL', 'CERTIFIED', 'CHALLENGED', 'DISCARDED', 'SPOILED'
  ))
);

create index ballots_precinct_id_idx on public.ballots (precinct_id);

create table public.batches (
  id uuid primary key default gen_random_uuid(),
  scope text not null,
  scope_id text not null,
  from_status text not null,
  to_status text not null,
  actor_id text not null,
  created_at timestamptz not null default now(),
  ballot_count integer not null check (ballot_count >= 0),
  constraint batches_scope_check check (scope in ('precinct', 'county')),
  constraint batches_from_status_check check (from_status in (
    'CAST', 'TALLIED_PRECINCT', 'REPORTED_UNOFFICIAL', 'CERTIFIED', 'CHALLENGED', 'DISCARDED', 'SPOILED'
  )),
  constraint batches_to_status_check check (to_status in (
    'CAST', 'TALLIED_PRECINCT', 'REPORTED_UNOFFICIAL', 'CERTIFIED', 'CHALLENGED', 'DISCARDED', 'SPOILED'
  ))
);

create table public.ballot_events (
  id uuid primary key default gen_random_uuid(),
  ballot_id uuid not null references public.ballots (id),
  precinct_id text not null references public.precincts (id),
  county_id text not null,
  event_type text not null,
  from_status text,
  to_status text,
  actor_role text not null,
  actor_id text not null,
  batch_id uuid references public.batches (id),
  reason text,
  nist_event_code text,
  occurred_at timestamptz not null,
  recorded_at timestamptz not null default now(),
  prev_hash text,
  hash text not null,
  constraint ballot_events_event_type_check check (event_type in (
    'CAST', 'STATUS_CHANGE', 'MISMATCH_DETECTED', 'CHALLENGE_RESOLVED', 'SPOILED'
  )),
  constraint ballot_events_from_status_check check (from_status in (
    'CAST', 'TALLIED_PRECINCT', 'REPORTED_UNOFFICIAL', 'CERTIFIED', 'CHALLENGED', 'DISCARDED', 'SPOILED'
  )),
  constraint ballot_events_to_status_check check (to_status in (
    'CAST', 'TALLIED_PRECINCT', 'REPORTED_UNOFFICIAL', 'CERTIFIED', 'CHALLENGED', 'DISCARDED', 'SPOILED'
  )),
  constraint ballot_events_actor_role_check check (actor_role in (
    'machine', 'poll_worker', 'county', 'state', 'simulator'
  )),
  -- Locked event schema: from_status and to_status are null for CAST.
  constraint ballot_events_cast_has_no_status check (
    event_type <> 'CAST' or (from_status is null and to_status is null)
  ),
  -- Locked event schema: reason is required for DISCARDED.
  constraint ballot_events_discard_needs_reason check (
    to_status is distinct from 'DISCARDED' or nullif(btrim(reason), '') is not null
  )
);

create index ballot_events_ballot_id_idx on public.ballot_events (ballot_id);

create table public.stage_records (
  id uuid primary key default gen_random_uuid(),
  scope text not null,
  scope_id text not null,
  stage text not null,
  merkle_root text not null,
  ballot_count integer not null check (ballot_count >= 0),
  -- Aggregate totals only (for example {"contest": {"choice": n}}); never per-ballot data.
  totals jsonb not null default '{}'::jsonb check (jsonb_typeof(totals) = 'object'),
  published_at timestamptz,
  signature text,
  constraint stage_records_scope_check check (scope in ('precinct', 'county')),
  constraint stage_records_stage_check check (stage in (
    'CAST', 'TALLIED_PRECINCT', 'REPORTED_UNOFFICIAL', 'CERTIFIED', 'CHALLENGED', 'DISCARDED', 'SPOILED'
  ))
);

-- ---------------------------------------------------------------------------------------------------
-- Insert-only: ballot_events and stage_records. Grants keep API roles out; the triggers stop
-- everyone else, including service_role and the table owner.
-- ---------------------------------------------------------------------------------------------------

create trigger ballot_events_insert_only
  before update or delete on public.ballot_events
  for each row execute function public.reject_mutation();

create trigger ballot_events_no_truncate
  before truncate on public.ballot_events
  for each statement execute function public.reject_mutation();

create trigger stage_records_insert_only
  before update or delete on public.stage_records
  for each row execute function public.reject_mutation();

create trigger stage_records_no_truncate
  before truncate on public.stage_records
  for each statement execute function public.reject_mutation();

-- ---------------------------------------------------------------------------------------------------
-- Row level security on every table
-- ---------------------------------------------------------------------------------------------------

alter table public.precincts enable row level security;
alter table public.machines enable row level security;
alter table public.ballots enable row level security;
alter table public.batches enable row level security;
alter table public.ballot_events enable row level security;
alter table public.stage_records enable row level security;

create policy precincts_public_read on public.precincts for select to anon, authenticated using (true);
create policy machines_public_read on public.machines for select to anon, authenticated using (true);
create policy ballots_public_read on public.ballots for select to anon, authenticated using (true);
create policy ballot_events_public_read on public.ballot_events for select to anon, authenticated using (true);
create policy stage_records_public_read on public.stage_records for select to anon, authenticated
  using (published_at is not null and published_at <= now());
-- batches: no anon/authenticated policy, so the public reads no batch rows.

-- Writes: service_role only (Supabase gives it BYPASSRLS; these policies keep it explicit if not).
create policy precincts_service_write on public.precincts for all to service_role using (true) with check (true);
create policy machines_service_write on public.machines for all to service_role using (true) with check (true);
create policy ballots_service_write on public.ballots for all to service_role using (true) with check (true);
create policy batches_service_write on public.batches for all to service_role using (true) with check (true);
create policy ballot_events_service_write on public.ballot_events for all to service_role using (true) with check (true);
create policy stage_records_service_write on public.stage_records for all to service_role using (true) with check (true);

-- ---------------------------------------------------------------------------------------------------
-- Grants. Supabase's default privileges grant everything to anon, authenticated and service_role,
-- so start from nothing and grant back only what each role needs.
-- ---------------------------------------------------------------------------------------------------

revoke all on public.precincts, public.machines, public.ballots, public.batches,
  public.ballot_events, public.stage_records
  from public, anon, authenticated, service_role;

-- Public reads (column lists keep ciphertext, ballot sequence, machine and event timing private).
grant select on public.precincts to anon, authenticated;
grant select on public.machines to anon, authenticated;
grant select (id, tracking_code, ciphertext_hash, precinct_id, cast_date, current_status)
  on public.ballots to anon, authenticated;
grant select (id, ballot_id, precinct_id, county_id, event_type, from_status, to_status, reason)
  on public.ballot_events to anon, authenticated;
grant select on public.stage_records to anon, authenticated;

-- Server writes. Insert-only tables get no update or delete. A ballot's ciphertext, hash and tracking
-- codes never change after insert: service_role may update only its status and mismatch flag.
grant select, insert, update, delete on public.precincts, public.machines, public.batches to service_role;
grant select, insert, delete on public.ballots to service_role;
grant update (current_status, mismatch) on public.ballots to service_role;
grant select, insert on public.ballot_events, public.stage_records to service_role;

-- ---------------------------------------------------------------------------------------------------
-- Public views: the surface the tracker reads. security_barrier so caller-supplied filters cannot see
-- rows or columns the view hides.
-- ---------------------------------------------------------------------------------------------------

-- Runs as the caller (security_invoker), so the base-table column grants and RLS still apply.
create view public.ballot_public
with (security_invoker = true, security_barrier = true)
as
select id, tracking_code, ciphertext_hash, precinct_id, cast_date, current_status
from public.ballots;

-- Dates only, in Indiana election-office time: never the time or the sequence of events. The public
-- cannot read occurred_at itself, so this view runs as its owner and exposes only the derived date.
create view public.ballot_event_public
with (security_invoker = false, security_barrier = true)
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
  (occurred_at at time zone 'America/Indiana/Indianapolis')::date as occurred_on
from public.ballot_events;

revoke all on public.ballot_public, public.ballot_event_public from public, anon, authenticated, service_role;
grant select on public.ballot_public, public.ballot_event_public to anon, authenticated, service_role;
