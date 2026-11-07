-- T-09 (#19): the database side of the poll-worker and official tools, approved for T-09 by Austin on #19.
--
-- Server code reaches the private ballot tables only through these functions, called with supabase-js
-- rpc() and the service-role key, after requireRole has passed (role, scope and MFA). Each function:
--   * lives in public (the schema PostgREST serves) but is EXECUTE-able by service_role only: Postgres
--     grants EXECUTE to PUBLIC by default, so that is revoked, along with anon and authenticated;
--   * is security invoker with an empty search_path, so it runs with service_role's own grants;
--   * does one job per rpc call, and PostgREST runs each call in one transaction: a batch either writes
--     its batch row, every event, every status change, its stage record and its upload hashes, or nothing.
--
-- The state-machine rules stay in packages/domain (validateBatchTransition, transition). SQL checks only
-- that the ballots named are exactly the ones in scope (no stale batch) and the challenge's held status.
--
-- Event hashes keep T-04's public format (supabase/tests/public-surface.test.ts, resolution 3):
--   CAST:          sha256('CAST:' || tracking_code)                       (seed and ingest)
--   later events:  sha256(prev_hash || ':' || event_type || ':' || from_status || ':' || to_status || ':' || day)
-- where day is occurred_on (YYYY-MM-DD, America/Indiana/Indianapolis), never a time, and prev_hash is the
-- ballot's chain head: its one event whose hash no other event of that ballot names as prev_hash. The head
-- is never chosen by timestamp.
--
-- A MISMATCH_DETECTED reason is only 'Cross-check Cn failed': reason is public, and a tracking code is never
-- publicly linked to a machine event (locked § Cross-checks privacy rule).
--
-- Custom SQLSTATEs the server maps to HTTP: VB400 bad input, VB404 unknown ballot, VB409 stale or wrong state.

-- ---------------------------------------------------------------------------------------------------
-- Private helpers (not in the Data API; service_role may execute them through the public functions)
-- ---------------------------------------------------------------------------------------------------

create function private.event_chain_head(p_ballot uuid) returns private.ballot_events
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_heads private.ballot_events[];
begin
  select coalesce(array_agg(e), '{}') into v_heads
  from private.ballot_events e
  where e.ballot_id = p_ballot
    and not exists (
      select 1 from private.ballot_events n where n.ballot_id = p_ballot and n.prev_hash = e.hash
    );
  if cardinality(v_heads) <> 1 then
    raise exception 'ballot % has % hash-chain heads, expected 1', p_ballot, cardinality(v_heads)
      using errcode = 'VB409';
  end if;
  return v_heads[1];
end;
$$;

create function private.event_hash(p_prev text, p_type text, p_from text, p_to text, p_at timestamptz)
returns text
language sql
stable
security invoker
set search_path = ''
as $$
  select encode(
    pg_catalog.sha256(convert_to(
      p_prev || ':' || p_type || ':' || p_from || ':' || p_to || ':'
        || to_char((p_at at time zone 'America/Indiana/Indianapolis')::date, 'YYYY-MM-DD'),
      'UTF8'
    )),
    'hex'
  );
$$;

create function private.record_uploads(p_uploads jsonb, p_actor uuid) returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_result jsonb;
begin
  if p_uploads is null or jsonb_typeof(p_uploads) <> 'array' then
    raise exception 'uploads must be an array' using errcode = 'VB400';
  end if;
  if p_actor is null then
    raise exception 'uploaded_by is required' using errcode = 'VB400';
  end if;

  insert into private.uploads (file_sha256, kind, scope_id, uploaded_by)
  select u.file_sha256, u.kind, u.scope_id, p_actor
  from jsonb_to_recordset(p_uploads) as u (file_sha256 text, kind text, scope_id text)
  on conflict (kind, scope_id, file_sha256) do nothing;

  -- uploaded_at and uploaded_by stay in the database.
  select coalesce(jsonb_agg(
    jsonb_build_object('id', up.id, 'kind', up.kind, 'scope_id', up.scope_id, 'file_sha256', up.file_sha256)
    order by u.ord
  ), '[]'::jsonb)
  into v_result
  from jsonb_array_elements(p_uploads) with ordinality as u (item, ord)
  join private.uploads up
    on up.kind = u.item ->> 'kind' and up.scope_id = u.item ->> 'scope_id' and up.file_sha256 = u.item ->> 'file_sha256';

  return v_result;
end;
$$;

revoke all on function private.event_chain_head(uuid) from public, anon, authenticated, service_role;
revoke all on function private.event_hash(text, text, text, text, timestamptz) from public, anon, authenticated, service_role;
revoke all on function private.record_uploads(jsonb, uuid) from public, anon, authenticated, service_role;
grant execute on function private.event_chain_head(uuid) to service_role;
grant execute on function private.event_hash(text, text, text, text, timestamptz) to service_role;
grant execute on function private.record_uploads(jsonb, uuid) to service_role;

-- ---------------------------------------------------------------------------------------------------
-- Reads for the official views and the batch preview
-- ---------------------------------------------------------------------------------------------------

-- Ballots per status in a precinct or county (precinct and county views).
create function public.official_status_counts(p_scope text, p_scope_id text)
returns table (status text, n integer)
language sql
stable
security invoker
set search_path = ''
as $$
  select b.current_status, count(*)::integer
  from private.ballots b
  join public.precincts p on p.id = b.precinct_id
  where (p_scope = 'precinct' and b.precinct_id = p_scope_id)
     or (p_scope = 'county' and p.county_id = p_scope_id)
  group by b.current_status
  order by b.current_status;
$$;

-- The ballots a batch would move, in hash order (never cast order).
create function public.official_batch_ballots(p_scope text, p_scope_id text, p_from text)
returns table (id uuid, ciphertext text, ciphertext_hash text, machine_id text)
language sql
stable
security invoker
set search_path = ''
as $$
  select b.id, b.ciphertext, b.ciphertext_hash, b.machine_id
  from private.ballots b
  join public.precincts p on p.id = b.precinct_id
  where b.current_status = p_from
    and ((p_scope = 'precinct' and b.precinct_id = p_scope_id)
      or (p_scope = 'county' and p.county_id = p_scope_id))
  order by b.ciphertext_hash, b.id;
$$;

-- C1: ballots recorded as cast on each machine of a precinct (spoiled ballots are not counted).
create function public.official_machine_ballot_counts(p_precinct text)
returns table (machine_id text, n integer)
language sql
stable
security invoker
set search_path = ''
as $$
  select b.machine_id, count(*)::integer
  from private.ballots b
  where b.precinct_id = p_precinct and b.current_status <> 'SPOILED'
  group by b.machine_id
  order by b.machine_id;
$$;

-- C3 and C4: published stage records of one stage, for a precinct, or for a county and its precincts.
create function public.official_stage_totals(p_scope text, p_scope_id text, p_stage text)
returns table (scope text, scope_id text, ballot_count integer, totals jsonb)
language sql
stable
security invoker
set search_path = ''
as $$
  select r.scope, r.scope_id, r.ballot_count, r.totals
  from public.stage_records r
  where r.stage = p_stage
    and ((r.scope = p_scope and r.scope_id = p_scope_id)
      or (p_scope = 'county' and r.scope = 'precinct'
          and r.scope_id in (select p.id from public.precincts p where p.county_id = p_scope_id)))
  order by r.scope, r.scope_id, r.id;
$$;

-- C4: ciphertexts of the county's ballots that left REPORTED_UNOFFICIAL through a challenge and have not
-- returned (still CHALLENGED, or DISCARDED). Decrypted only in aggregate by the caller.
create function public.official_challenge_removed(p_county text)
returns table (ciphertext text)
language sql
stable
security invoker
set search_path = ''
as $$
  select b.ciphertext
  from private.ballots b
  join public.precincts p on p.id = b.precinct_id
  where p.county_id = p_county
    and b.current_status in ('CHALLENGED', 'DISCARDED')
    and exists (
      select 1 from private.ballot_events e
      where e.ballot_id = b.id and e.from_status = 'REPORTED_UNOFFICIAL' and e.to_status = 'CHALLENGED'
    )
  order by b.ciphertext_hash, b.id;
$$;

-- Where a ballot is, for the challenge route's scope check and the domain transition check.
-- held_status is the from_status of the chain-head event into CHALLENGED (null unless challenged).
create function public.official_ballot_scope(p_ballot uuid)
returns table (precinct_id text, county_id text, current_status text, held_status text)
language plpgsql
stable
security invoker
set search_path = ''
as $$
begin
  return query
  select b.precinct_id, p.county_id, b.current_status,
         case when b.current_status = 'CHALLENGED' then (
           select h.from_status from private.event_chain_head(b.id) h where h.to_status = 'CHALLENGED'
         ) end
  from private.ballots b
  join public.precincts p on p.id = b.precinct_id
  where b.id = p_ballot;
end;
$$;

-- The mismatch report: mismatched or challenged ballots in scope, with the check from the latest event
-- into CHALLENGED and the date (never the time) it happened. Officials only; machine ids are official data.
create function public.official_mismatches(p_scope text, p_scope_id text)
returns table (
  ballot_id uuid, tracking_code text, precinct_id text, machine_id text, current_status text,
  reason text, detected_on date
)
language sql
stable
security invoker
set search_path = ''
as $$
  select b.id, b.tracking_code, b.precinct_id, b.machine_id, b.current_status, ev.reason, ev.occurred_on
  from private.ballots b
  join public.precincts p on p.id = b.precinct_id
  left join lateral (
    select e.reason, e.occurred_on
    from private.ballot_events e
    where e.ballot_id = b.id and e.to_status = 'CHALLENGED'
    order by e.occurred_at desc, e.recorded_at desc, e.id
    limit 1
  ) ev on true
  where (b.mismatch or b.current_status = 'CHALLENGED')
    and ((p_scope = 'precinct' and b.precinct_id = p_scope_id)
      or (p_scope = 'county' and p.county_id = p_scope_id))
  order by b.precinct_id, b.tracking_code;
$$;

-- ---------------------------------------------------------------------------------------------------
-- Writes
-- ---------------------------------------------------------------------------------------------------

-- Uploads (POST /api/events): records each file's hash; a re-upload returns the existing row.
create function public.official_record_uploads(p_uploads jsonb, p_actor uuid) returns jsonb
language sql
security invoker
set search_path = ''
as $$
  select private.record_uploads(p_uploads, p_actor);
$$;

-- One batch (POST /api/batches), all or nothing.
create function public.official_run_batch(
  p_scope text,
  p_scope_id text,
  p_from text,
  p_to text,
  p_actor_role text,
  p_actor_id text,
  p_advance uuid[],
  p_challenge jsonb,
  p_stage_record jsonb,
  p_uploads jsonb
) returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_now timestamptz := now();
  v_advance uuid[] := coalesce(p_advance, '{}');
  v_challenge jsonb := coalesce(p_challenge, '[]'::jsonb);
  v_challenge_ids uuid[];
  v_in_scope uuid[];
  v_named uuid[];
  v_batch uuid;
  v_record uuid;
  v_ballot record;
  v_head private.ballot_events;
  v_is_advance boolean;
  v_type text;
  v_to text;
  v_reason text;
  v_uploads jsonb;
begin
  if p_scope is null or p_scope not in ('precinct', 'county') or nullif(btrim(p_scope_id), '') is null then
    raise exception 'scope must be a precinct or county id' using errcode = 'VB400';
  end if;
  if p_actor_role is null or p_actor_role not in ('poll_worker', 'county', 'state') or nullif(btrim(p_actor_id), '') is null then
    raise exception 'an official actor is required' using errcode = 'VB400';
  end if;
  if jsonb_typeof(v_challenge) <> 'array' then
    raise exception 'challenge must be an array' using errcode = 'VB400';
  end if;
  if exists (
    select 1 from jsonb_array_elements(v_challenge) c
    where jsonb_typeof(c) <> 'object' or coalesce(c ->> 'check', '') !~ '^C[1-4]$' or (c ->> 'id') is null
  ) then
    raise exception 'each challenge needs an id and a check C1..C4' using errcode = 'VB400';
  end if;
  select coalesce(array_agg((c ->> 'id')::uuid), '{}') into v_challenge_ids from jsonb_array_elements(v_challenge) c;

  -- Lock every ballot in scope at p_from, then require the caller to have named exactly those.
  select coalesce(array_agg(s.id order by s.id), '{}') into v_in_scope
  from (
    select b.id
    from private.ballots b
    join public.precincts p on p.id = b.precinct_id
    where b.current_status = p_from
      and ((p_scope = 'precinct' and b.precinct_id = p_scope_id)
        or (p_scope = 'county' and p.county_id = p_scope_id))
    for update of b
  ) s;
  select coalesce(array_agg(x order by x), '{}') into v_named from unnest(v_advance || v_challenge_ids) x;
  if cardinality(v_in_scope) = 0 or v_named is distinct from v_in_scope then
    raise exception 'stale batch: the ballots in scope changed' using errcode = 'VB409';
  end if;

  -- Never advance a ballot without a published, signed stage record (and never publish one for nothing).
  if cardinality(v_advance) > 0 then
    if p_stage_record is null
       or jsonb_typeof(p_stage_record) <> 'object'
       or coalesce(p_stage_record ->> 'merkle_root', '') !~ '^[0-9a-f]{64}$'
       or nullif(btrim(p_stage_record ->> 'signature'), '') is null
       or jsonb_typeof(p_stage_record -> 'totals') is distinct from 'object'
       or (p_stage_record ->> 'ballot_count') is distinct from cardinality(v_advance)::text then
      raise exception 'advancing ballots requires a signed stage record for exactly those ballots'
        using errcode = 'VB400';
    end if;
  elsif p_stage_record is not null and p_stage_record <> 'null'::jsonb then
    raise exception 'no stage record without ballots to advance' using errcode = 'VB400';
  end if;

  insert into public.batches (scope, scope_id, from_status, to_status, actor_id, ballot_count)
  values (p_scope, p_scope_id, p_from, p_to, p_actor_id, cardinality(v_advance))
  returning id into v_batch;

  for v_ballot in
    select b.id, b.precinct_id, p.county_id
    from private.ballots b
    join public.precincts p on p.id = b.precinct_id
    where b.id = any (v_in_scope)
    order by b.ciphertext_hash, b.id
  loop
    v_is_advance := v_ballot.id = any (v_advance);
    if v_is_advance then
      v_type := 'STATUS_CHANGE';
      v_to := p_to;
      v_reason := null;
    else
      v_type := 'MISMATCH_DETECTED';
      v_to := 'CHALLENGED';
      select 'Cross-check ' || (c ->> 'check') || ' failed' into v_reason
      from jsonb_array_elements(v_challenge) c
      where (c ->> 'id')::uuid = v_ballot.id
      limit 1;
    end if;

    v_head := private.event_chain_head(v_ballot.id);
    insert into private.ballot_events (
      ballot_id, precinct_id, county_id, event_type, from_status, to_status, actor_role, actor_id,
      batch_id, reason, occurred_at, prev_hash, hash
    ) values (
      v_ballot.id, v_ballot.precinct_id, v_ballot.county_id, v_type, p_from, v_to, p_actor_role, p_actor_id,
      case when v_is_advance then v_batch end, v_reason, v_now, v_head.hash,
      private.event_hash(v_head.hash, v_type, p_from, v_to, v_now)
    );

    update private.ballots
    set current_status = v_to, mismatch = mismatch or not v_is_advance
    where id = v_ballot.id;
  end loop;

  if cardinality(v_advance) > 0 then
    insert into public.stage_records (scope, scope_id, stage, merkle_root, ballot_count, totals, signature)
    values (
      p_scope, p_scope_id, p_to, p_stage_record ->> 'merkle_root', cardinality(v_advance),
      p_stage_record -> 'totals', p_stage_record ->> 'signature'
    )
    returning id into v_record;
  end if;

  v_uploads := private.record_uploads(coalesce(p_uploads, '[]'::jsonb), p_actor_id::uuid);

  return jsonb_build_object(
    'batch_id', v_batch,
    'count', cardinality(v_advance),
    'challenged', cardinality(v_challenge_ids),
    'stage_record_id', v_record,
    'uploads', v_uploads
  );
end;
$$;

-- Resolve one challenge (POST /api/challenges/{id}/resolve): back to the held status, or DISCARDED with a
-- reason. Returns the new status.
create function public.official_resolve_challenge(
  p_ballot uuid,
  p_to text,
  p_reason text,
  p_actor_role text,
  p_actor_id text
) returns text
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_now timestamptz := now();
  v_status text;
  v_precinct text;
  v_county text;
  v_head private.ballot_events;
  v_reason text := nullif(btrim(p_reason), '');
begin
  if p_actor_role is null or p_actor_role not in ('county', 'state') or nullif(btrim(p_actor_id), '') is null then
    raise exception 'a county or state official is required' using errcode = 'VB400';
  end if;

  select b.current_status, b.precinct_id, p.county_id into v_status, v_precinct, v_county
  from private.ballots b
  join public.precincts p on p.id = b.precinct_id
  where b.id = p_ballot
  for update of b;
  if not found then
    raise exception 'unknown ballot' using errcode = 'VB404';
  end if;
  if v_status <> 'CHALLENGED' then
    raise exception 'ballot is not challenged' using errcode = 'VB409';
  end if;

  v_head := private.event_chain_head(p_ballot);
  if v_head.to_status is distinct from 'CHALLENGED' then
    raise exception 'the latest event did not challenge this ballot' using errcode = 'VB409';
  end if;
  if p_to = 'DISCARDED' then
    if v_reason is null then
      raise exception 'rejecting a challenge requires a reason' using errcode = 'VB400';
    end if;
  elsif p_to is distinct from v_head.from_status then
    raise exception 'an accepted challenge returns to the status held before it' using errcode = 'VB400';
  end if;

  insert into private.ballot_events (
    ballot_id, precinct_id, county_id, event_type, from_status, to_status, actor_role, actor_id,
    reason, occurred_at, prev_hash, hash
  ) values (
    p_ballot, v_precinct, v_county, 'CHALLENGE_RESOLVED', 'CHALLENGED', p_to, p_actor_role, p_actor_id,
    v_reason, v_now, v_head.hash, private.event_hash(v_head.hash, 'CHALLENGE_RESOLVED', 'CHALLENGED', p_to, v_now)
  );

  update private.ballots set current_status = p_to where id = p_ballot;
  return p_to;
end;
$$;

-- ---------------------------------------------------------------------------------------------------
-- EXECUTE: service_role only
-- ---------------------------------------------------------------------------------------------------

revoke all on function public.official_status_counts(text, text) from public, anon, authenticated;
revoke all on function public.official_batch_ballots(text, text, text) from public, anon, authenticated;
revoke all on function public.official_machine_ballot_counts(text) from public, anon, authenticated;
revoke all on function public.official_stage_totals(text, text, text) from public, anon, authenticated;
revoke all on function public.official_challenge_removed(text) from public, anon, authenticated;
revoke all on function public.official_ballot_scope(uuid) from public, anon, authenticated;
revoke all on function public.official_mismatches(text, text) from public, anon, authenticated;
revoke all on function public.official_record_uploads(jsonb, uuid) from public, anon, authenticated;
revoke all on function public.official_run_batch(text, text, text, text, text, text, uuid[], jsonb, jsonb, jsonb)
  from public, anon, authenticated;
revoke all on function public.official_resolve_challenge(uuid, text, text, text, text) from public, anon, authenticated;

grant execute on function public.official_status_counts(text, text) to service_role;
grant execute on function public.official_batch_ballots(text, text, text) to service_role;
grant execute on function public.official_machine_ballot_counts(text) to service_role;
grant execute on function public.official_stage_totals(text, text, text) to service_role;
grant execute on function public.official_challenge_removed(text) to service_role;
grant execute on function public.official_ballot_scope(uuid) to service_role;
grant execute on function public.official_mismatches(text, text) to service_role;
grant execute on function public.official_record_uploads(jsonb, uuid) to service_role;
grant execute on function public.official_run_batch(text, text, text, text, text, text, uuid[], jsonb, jsonb, jsonb)
  to service_role;
grant execute on function public.official_resolve_challenge(uuid, text, text, text, text) to service_role;
