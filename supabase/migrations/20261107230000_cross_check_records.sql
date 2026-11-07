-- T-10 (#20): the records the cross-checks compare and their results. An extension of the locked data
-- model, approved by Austin on #20; docs/locked-interfaces.md lists the three tables. ballot_events is
-- unchanged. Mapping from the NIST formats to these columns: docs/nist-mapping.md.
--
--   machine_log_imports  one row per device per uploaded NIST SP 1500-101 event log: a summary only
--   official_results     one row per precinct or county per uploaded NIST SP 1500-100 results report
--   check_results        one row per C1 to C4 result for one machine, precinct or county
--
-- All three live in private, out of the Data API (supabase/config.toml [api] schemas), and are
-- official-only: machine-level records stay away from the public (locked privacy rule). They hold no
-- tracking code, no ballot id, no machine event time and no voter identity. A machine log is stored as
-- counts and flags plus its file hash, never its timestamped events. check_results stores ids and
-- counts, never which ballots a failure challenged: the challenges are ballot_events rows.
--
-- Access model (official-only):
--   * Only service_role holds grants. Officials read and write through server routes that run
--     requireRole (role and MFA) first. anon and authenticated get nothing: a Supabase Auth account
--     alone (which anyone could create) never reaches these rows.
--   * All three are insert-only for everyone, the table owner included: an upload or a check result is
--     an audit record, corrected by a new row, never edited.
--   * uploaded_by is the official's auth user id, never a name.
--
-- Value lists mirror @vbt/domain (CROSS_CHECKS, CHECK_SCOPES, CHECK_FAILURES) and @vbt/events
-- (LOG_FORMATS, RESULTS_STAGE_RULES); supabase/tests/cross-check-records.test.ts checks this.

create table private.machine_log_imports (
  id uuid primary key default gen_random_uuid(),
  -- CDF Device.Id; an unknown device is an import error.
  machine_id text not null references public.machines (id),
  precinct_id text not null references public.precincts (id),
  county_id text not null,
  -- CDF ElectionEventLog.ElectionId, when the log has one.
  election_id text,
  format text not null,
  -- SHA-256 of the uploaded file, hex (POST /api/events records file hashes).
  file_sha256 text not null check (file_sha256 ~ '^[0-9a-f]{64}$'),
  ballots_counted integer not null check (ballots_counted >= 0),
  polls_opened boolean not null,
  polls_closed boolean not null,
  error_count integer not null check (error_count >= 0),
  unmapped_codes text[] not null default '{}',
  uploaded_by uuid not null,
  imported_at timestamptz not null default now(),
  constraint machine_log_imports_format_check check (format in ('cdf-json', 'cdf-xml')),
  -- The same file uploaded twice is one import.
  constraint machine_log_imports_once unique (file_sha256, machine_id)
);

create table private.official_results (
  id uuid primary key default gen_random_uuid(),
  scope text not null,
  scope_id text not null,
  county_id text not null,
  stage text not null,
  -- ElectionReport.Status
  nist_status text not null,
  -- Aggregate totals only ({"contest": {"selection": n}}); never per-ballot data.
  totals jsonb not null check (jsonb_typeof(totals) = 'object'),
  -- BallotCounts.BallotsCast, when the report has it.
  ballot_count integer check (ballot_count >= 0),
  file_sha256 text not null check (file_sha256 ~ '^[0-9a-f]{64}$'),
  uploaded_by uuid not null,
  imported_at timestamptz not null default now(),
  constraint official_results_scope_check check (scope in ('precinct', 'county')),
  constraint official_results_stage_check check (stage in ('TALLIED_PRECINCT', 'REPORTED_UNOFFICIAL', 'CERTIFIED')),
  constraint official_results_nist_status_check check (nist_status in ('unofficial-complete', 'certified')),
  -- RESULTS_STAGE_RULES: a precinct report is TALLIED_PRECINCT and holds only precinct rows; a county
  -- report is REPORTED_UNOFFICIAL (unofficial-complete) or CERTIFIED (certified).
  constraint official_results_stage_rule check (
    (stage, nist_status) in (
      ('TALLIED_PRECINCT', 'unofficial-complete'),
      ('REPORTED_UNOFFICIAL', 'unofficial-complete'),
      ('CERTIFIED', 'certified')
    ) and (stage <> 'TALLIED_PRECINCT' or scope = 'precinct')
  ),
  constraint official_results_county_scope check (scope <> 'county' or county_id = scope_id),
  constraint official_results_once unique (file_sha256, scope, scope_id)
);

create table private.check_results (
  id uuid primary key default gen_random_uuid(),
  check_id text not null,
  scope text not null,
  scope_id text not null,
  stage text not null,
  passed boolean not null,
  failure text,
  -- [{"field": "ballot_count" | "votes", "contestId"?, "selectionId"?, "expected", "actual"}]:
  -- ids and counts only.
  mismatches jsonb not null default '[]'::jsonb check (jsonb_typeof(mismatches) = 'array'),
  -- The batch transition the check gated, once T-09 wires the checks in.
  batch_id uuid references public.batches (id),
  created_at timestamptz not null default now(),
  constraint check_results_check_id_check check (check_id in ('C1', 'C2', 'C3', 'C4')),
  constraint check_results_scope_check check (scope in ('machine', 'precinct', 'county')),
  constraint check_results_stage_check check (stage in ('TALLIED_PRECINCT', 'REPORTED_UNOFFICIAL', 'CERTIFIED')),
  -- The locked check table: each check gates one stage, for the scopes it can name (C3 names a precinct
  -- when the county report breaks down by precinct).
  constraint check_results_definition check (
    (check_id, scope, stage) in (
      ('C1', 'machine', 'TALLIED_PRECINCT'),
      ('C2', 'precinct', 'TALLIED_PRECINCT'),
      ('C3', 'county', 'REPORTED_UNOFFICIAL'),
      ('C3', 'precinct', 'REPORTED_UNOFFICIAL'),
      ('C4', 'county', 'CERTIFIED')
    )
  ),
  constraint check_results_failure_check check (failure in (
    'MISSING_SOURCE', 'DUPLICATE_SOURCE', 'NO_BALLOT_COUNT_EVENTS', 'COUNT_MISMATCH', 'TOTALS_MISMATCH',
    'INVALID_RESOLUTION', 'UNEXPLAINED_DIFFERENCE'
  )),
  -- A passed check has no failure and no mismatches; a failed one names its failure.
  constraint check_results_outcome check (
    (passed and failure is null and mismatches = '[]'::jsonb) or (not passed and failure is not null)
  )
);

-- ---------------------------------------------------------------------------------------------------
-- Insert-only, as ballot_events and stage_records.
-- ---------------------------------------------------------------------------------------------------

create trigger machine_log_imports_insert_only
  before update or delete on private.machine_log_imports
  for each row execute function public.reject_mutation();
create trigger machine_log_imports_no_truncate
  before truncate on private.machine_log_imports
  for each statement execute function public.reject_mutation();

create trigger official_results_insert_only
  before update or delete on private.official_results
  for each row execute function public.reject_mutation();
create trigger official_results_no_truncate
  before truncate on private.official_results
  for each statement execute function public.reject_mutation();

create trigger check_results_insert_only
  before update or delete on private.check_results
  for each row execute function public.reject_mutation();
create trigger check_results_no_truncate
  before truncate on private.check_results
  for each statement execute function public.reject_mutation();

-- ---------------------------------------------------------------------------------------------------
-- Row level security: service_role only; no policy admits anon or authenticated.
-- ---------------------------------------------------------------------------------------------------

alter table private.machine_log_imports enable row level security;
alter table private.official_results enable row level security;
alter table private.check_results enable row level security;

create policy machine_log_imports_service_role on private.machine_log_imports for all to service_role
  using (true) with check (true);
create policy official_results_service_role on private.official_results for all to service_role
  using (true) with check (true);
create policy check_results_service_role on private.check_results for all to service_role
  using (true) with check (true);

-- ---------------------------------------------------------------------------------------------------
-- Grants. private's default privileges already grant nothing; revoke anyway so this file states the
-- whole access model.
-- ---------------------------------------------------------------------------------------------------

revoke all on private.machine_log_imports, private.official_results, private.check_results
  from public, anon, authenticated, service_role;

grant select, insert on private.machine_log_imports, private.official_results, private.check_results to service_role;
