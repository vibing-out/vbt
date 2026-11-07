-- T-09 (#19): file hashes for official uploads. A locked data-model addition, approved by Austin on #19
-- (option a): private.uploads(id, file_sha256, kind, scope_id, uploaded_by, uploaded_at).
--
-- POST /api/events and POST /api/batches record the SHA-256 of every exported machine log and results
-- file an official uploads (locked API: "file hashes recorded"). Only the hash is kept, never the file.
--
-- Access model:
--   * private schema: out of the Data API. RLS on; no grants at all to anon or authenticated.
--   * service_role (server code, after requireRole) may select and insert only: an audit row is never
--     changed or removed. uploaded_at never leaves the private schema (no ordering leaks).
--   * uploaded_by is the official's auth user id, with no foreign key, so the audit row outlives the
--     account. No voter data is ever stored here.
--   * unique (kind, scope_id, file_sha256): uploading the same file again returns the existing row.

create table private.uploads (
  id uuid primary key default gen_random_uuid(),
  file_sha256 text not null,
  kind text not null,
  scope_id text not null,
  uploaded_by uuid not null,
  uploaded_at timestamptz not null default now(),
  constraint uploads_file_sha256_check check (file_sha256 ~ '^[0-9a-f]{64}$'),
  constraint uploads_kind_check check (kind in ('machine_log', 'precinct_totals', 'county_totals', 'certified_totals')),
  constraint uploads_scope_id_check check (nullif(btrim(scope_id), '') is not null),
  constraint uploads_kind_scope_file_key unique (kind, scope_id, file_sha256)
);

alter table private.uploads enable row level security;

create policy uploads_service_write on private.uploads for all to service_role using (true) with check (true);

-- The private schema's default privileges already grant nothing; say so explicitly anyway.
revoke all on private.uploads from public, anon, authenticated, service_role;
grant select, insert on private.uploads to service_role;
