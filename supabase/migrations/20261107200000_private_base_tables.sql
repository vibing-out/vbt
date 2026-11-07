-- T-04 follow-up (#12), resolution 1 completed: no ordering leaks through the base tables.
-- A forward migration; 20261107170000_core_schema.sql and 20261107190000_public_surface_fixes.sql stay
-- as merged.
--
-- The ordered views alone were not enough. ballots and ballot_events sat in public, the schema the
-- Supabase Data API (PostgREST, pg_graphql) exposes, and the public roles could SELECT their public
-- columns there with no ORDER BY, which returns rows in insertion, that is cast, order (locked
-- principle 5). The base tables move to the schema private, which the Data API does not expose
-- (supabase/config.toml [api] schemas; never add private there or in the hosted project's settings).
-- public keeps only the hash-ordered views ballot_public and ballot_event_public.
--
-- The views stay security_invoker (resolution 2), so the public roles still need USAGE on private
-- and their column grants and RLS policies on the two tables. Those move with the tables unchanged:
-- ALTER TABLE ... SET SCHEMA keeps grants, policies, triggers, indexes, constraints and the generated
-- occurred_on column, and the views (bound by oid) follow the tables.
--
-- Server code (service_role) reaches the base tables through a direct Postgres connection or a
-- function a later ticket adds in public, not through the Data API.

create schema private;

-- Only USAGE: no API role may create objects in private.
revoke all on schema private from public, anon, authenticated, service_role;
grant usage on schema private to anon, authenticated, service_role;

-- A table added to private later starts with no privileges for the API roles (unlike public, where
-- Supabase's default privileges grant everything); its migration grants what each role needs.
alter default privileges in schema private revoke all on tables from public, anon, authenticated, service_role;
alter default privileges in schema private revoke all on sequences from public, anon, authenticated, service_role;
alter default privileges in schema private revoke all on functions from public, anon, authenticated, service_role;

alter table public.ballots set schema private;
alter table public.ballot_events set schema private;
