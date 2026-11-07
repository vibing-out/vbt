-- T-20 (#13): official sign-in roles. An extension of the locked data model, approved by Austin on #13.
--
-- One row per official (poll worker, county or state) who signs in through Supabase Auth with TOTP
-- multi-factor authentication. Voters never have accounts, so no row here is ever a voter; the
-- columns hold an auth user id, a role and a scope only, never a name, email or other identity.
--
-- Scope shape follows T-04's batches (scope + scope_id):
--   poll_worker -> ('precinct', precinct id)
--   county      -> ('county', county id)
--   state       -> (null, null): every precinct and county
-- Role values mirror @vbt/domain OFFICIAL_ROLES exactly (supabase/tests checks this). The scope rule
-- (who may act on what) lives in packages/domain officialMayActOn, not in SQL.
--
-- Access model:
--   * authenticated reads only its own row, and only from an aal2 (multi-factor) session. The aal2
--     policy is restrictive, so it applies on top of every permissive policy.
--   * anon reads nothing. Nobody but service_role writes (official writes elsewhere stay service_role
--     after a server-side requireRole, as T-04 shipped).

create table public.official_roles (
  user_id uuid primary key references auth.users (id) on delete cascade,
  role text not null,
  scope text,
  scope_id text,
  created_at timestamptz not null default now(),
  constraint official_roles_role_check check (role in ('poll_worker', 'county', 'state')),
  constraint official_roles_scope_check check (
    (role = 'poll_worker' and scope = 'precinct' and nullif(btrim(scope_id), '') is not null)
    or (role = 'county' and scope = 'county' and nullif(btrim(scope_id), '') is not null)
    or (role = 'state' and scope is null and scope_id is null)
  )
);

alter table public.official_roles enable row level security;

create policy official_roles_read_own on public.official_roles for select to authenticated
  using (user_id = (select auth.uid()));

-- Supabase MFA guide: require aal2 with a restrictive policy (a permissive one would widen access).
create policy official_roles_require_aal2 on public.official_roles as restrictive for all to authenticated
  using ((select auth.jwt() ->> 'aal') = 'aal2')
  with check ((select auth.jwt() ->> 'aal') = 'aal2');

create policy official_roles_service_write on public.official_roles for all to service_role
  using (true) with check (true);

-- Supabase's default privileges grant everything to the API roles: start from nothing.
revoke all on public.official_roles from public, anon, authenticated, service_role;

-- requireRole needs the grant only; created_at stays server-side.
grant select (user_id, role, scope, scope_id) on public.official_roles to authenticated;
grant select, insert, update, delete on public.official_roles to service_role;
