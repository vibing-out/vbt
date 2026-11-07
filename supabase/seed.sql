-- Dev seed: 3 precincts, 3 machines, 50 ballots (each with its CAST event). Local and test databases only.
-- `supabase db reset` / `supabase start` run it (supabase/config.toml [db.seed]); the production migrate
-- job runs `supabase db push` without --include-seed, so it never reaches vbt-prod.
-- Ciphertexts and tracking codes are placeholders; real ones come from packages/crypto. No voter data.

insert into public.precincts (id, county_id, name) values
  ('18097-001', '18097', 'Center 1'),
  ('18097-002', '18097', 'Center 2'),
  ('18057-001', '18057', 'Fall Creek 1');

insert into public.machines (id, precinct_id, vendor, model, public_key) values
  ('M-18097-001-A', '18097-001', 'SimVendor', 'SV-1', 'seed-public-key-a'),
  ('M-18097-002-A', '18097-002', 'SimVendor', 'SV-1', 'seed-public-key-b'),
  ('M-18057-001-A', '18057-001', 'SimVendor', 'SV-1', 'seed-public-key-c');

-- 17 + 17 + 16 ballots. Tracking codes chain to the previous code on the same machine.
with numbered as (
  select
    n,
    case when n <= 17 then '18097-001' when n <= 34 then '18097-002' else '18057-001' end as precinct_id,
    case when n <= 17 then 'M-18097-001-A' when n <= 34 then 'M-18097-002-A' else 'M-18057-001-A' end as machine_id,
    case when n in (1, 18, 35) then null else 'SEED-' || lpad((n - 1)::text, 4, '0') end as prev_tracking_code,
    'seed-ciphertext-' || n as ciphertext
  from generate_series(1, 50) as n
)
insert into private.ballots (
  tracking_code, prev_tracking_code, ciphertext, ciphertext_hash, ballot_style,
  precinct_id, machine_id, cast_date, current_status, mismatch
)
select
  'SEED-' || lpad(n::text, 4, '0'),
  prev_tracking_code,
  ciphertext,
  encode(sha256(convert_to(ciphertext, 'UTF8')), 'hex'),
  'general-2026',
  precinct_id,
  machine_id,
  date '2026-11-03',
  'CAST',
  false
from numbered;

insert into private.ballot_events (
  ballot_id, precinct_id, county_id, event_type, from_status, to_status,
  actor_role, actor_id, nist_event_code, occurred_at, prev_hash, hash
)
select
  b.id,
  b.precinct_id,
  p.county_id,
  'CAST',
  null,
  null,
  'simulator',
  b.machine_id,
  null,
  timestamptz '2026-11-03 12:00:00+00',
  null,
  encode(sha256(convert_to('CAST:' || b.tracking_code, 'UTF8')), 'hex')
from private.ballots b
join public.precincts p on p.id = b.precinct_id;
