-- T-05 (#15): event ingest and batch transitions with published stage records.
--
--   * private.ingest_files: one insert-only row per uploaded file, keyed by the SHA-256 of its exact
--     bytes (locked API: "file hashes recorded"). A locked-interface addition approved by Austin on
--     #15 (https://github.com/vibing-out/vbt/issues/15#issuecomment-6711512134) and listed in
--     docs/locked-interfaces.md, Data model.
--   * A unique index on private.ballot_events (ballot_id, prev_hash), nulls not distinct: a ballot's
--     chain can never fork, and it has exactly one first event.
--   * Four RPCs in public for server code (service_role through supabase-js .rpc()): ingest_ballot_record,
--     chain_heads, batch_members and apply_batch. Each is security definer with an empty search_path and
--     schema-qualified names, executable by service_role only. Each returns one jsonb value, so the
--     Data API's max-rows limit can never silently cut a result short.
--
-- No transition rules live here: apps/web checks every move with @vbt/domain before it calls an RPC.
-- The RPCs check only that nothing changed between that read and this write (status, chain head,
-- batch membership), and raise SQLSTATE VB409 when something did, so the whole call rolls back.
--
-- No column holds voter identity. actor_id is an official's auth user id or a machine id.

-- ---------------------------------------------------------------------------------------------------
-- private.ingest_files
-- ---------------------------------------------------------------------------------------------------

create table private.ingest_files (
  id uuid primary key default gen_random_uuid(),
  sha256 text not null unique check (sha256 ~ '^[0-9a-f]{64}$'),
  kind text not null check (kind in ('ballot_record')),
  actor_id text not null check (btrim(actor_id) <> ''),
  recorded_at timestamptz not null default now(),
  ballot_count integer not null check (ballot_count >= 0)
);

create trigger ingest_files_insert_only
  before update or delete on private.ingest_files
  for each row execute function public.reject_mutation();

create trigger ingest_files_no_truncate
  before truncate on private.ingest_files
  for each statement execute function public.reject_mutation();

alter table private.ingest_files enable row level security;

-- No anon or authenticated grant or policy: the public never sees upload records. service_role reads
-- them (Supabase gives it BYPASSRLS; the policy keeps that explicit if not). Inserts happen only inside
-- ingest_ballot_record, which runs as the owner.
create policy ingest_files_service_read on private.ingest_files for select to service_role using (true);

revoke all on private.ingest_files from public, anon, authenticated, service_role;
grant select on private.ingest_files to service_role;

-- ---------------------------------------------------------------------------------------------------
-- One chain per ballot: no two events share a predecessor, and only one has none.
-- ---------------------------------------------------------------------------------------------------

create unique index ballot_events_ballot_id_prev_hash_key
  on private.ballot_events (ballot_id, prev_hash) nulls not distinct;

-- ---------------------------------------------------------------------------------------------------
-- Internal: chain heads (C9). The head is the event whose hash is no other event's prev_hash, never
-- the latest by time. `heads` above 1 means a broken chain; callers refuse it.
-- ---------------------------------------------------------------------------------------------------

create function private.chain_heads_for(p_ballot_ids uuid[])
returns table (ballot_id uuid, head_hash text, heads integer)
language sql
stable
set search_path = ''
as $$
  select e.ballot_id, max(e.hash), count(*)::integer
  from private.ballot_events e
  where e.ballot_id = any (p_ballot_ids)
    and not exists (
      select 1 from private.ballot_events f
      where f.ballot_id = e.ballot_id and f.prev_hash = e.hash
    )
  group by e.ballot_id
$$;

revoke all on function private.chain_heads_for(uuid[]) from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------------------------------
-- chain_heads(codes): read-only. For each existing tracking code, what ingest needs to tell a
-- duplicate from a mismatch and to chain a mismatch's events.
-- ---------------------------------------------------------------------------------------------------

create function public.chain_heads(p_codes text[])
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_result jsonb;
begin
  with found as (
    select b.id, b.tracking_code, b.ciphertext_hash, b.current_status, b.precinct_id, p.county_id
    from private.ballots b
    join public.precincts p on p.id = b.precinct_id
    where b.tracking_code = any (p_codes)
  )
  select coalesce(jsonb_agg(jsonb_build_object(
      'ballot_id', f.id,
      'tracking_code', f.tracking_code,
      'ciphertext_hash', f.ciphertext_hash,
      'current_status', f.current_status,
      'precinct_id', f.precinct_id,
      'county_id', f.county_id,
      'head_hash', h.head_hash,
      'heads', coalesce(h.heads, 0)
    ) order by f.tracking_code), '[]'::jsonb)
  into v_result
  from found f
  left join private.chain_heads_for(array(select id from found)) h on h.ballot_id = f.id;
  return v_result;
end;
$$;

-- ---------------------------------------------------------------------------------------------------
-- ingest_ballot_record(file): one uploaded ballot record, all or nothing (C1 to C7, C18, C19).
--
-- {
--   "sha256": "<hex of the file bytes>", "kind": "ballot_record", "actor_id": "<uploader user id>",
--   "county_id": "...", "ballot_count": n,
--   "ballots": [{ tracking_code, prev_tracking_code, ciphertext, ciphertext_hash, ballot_style,
--                 precinct_id, machine_id, cast_date, occurred_at, actor_role, actor_id, hash }],
--   "mismatches": [{ tracking_code, ciphertext_hash (uploaded), expected_status, new_status | null,
--                    events: [{ event_type, from_status, to_status, reason, occurred_at,
--                               actor_role, actor_id, prev_hash, hash }] }]
-- }
-- "ballots" are new codes (each gets its CAST event); duplicates are left out by the caller.
-- Returns { file_id, event_ids }.
-- ---------------------------------------------------------------------------------------------------

create function public.ingest_ballot_record(p_file jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_file_id uuid;
  v_event_ids uuid[];
  v_event_id uuid;
  v_mismatch jsonb;
  v_event jsonb;
  v_ballot record;
  v_head record;
begin
  if exists (select 1 from private.ingest_files where sha256 = p_file ->> 'sha256') then
    raise exception 'this file was already uploaded' using errcode = 'VB409';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(coalesce(p_file -> 'ballots', '[]'::jsonb)) x
    left join public.precincts p on p.id = x ->> 'precinct_id'
    where p.county_id is distinct from p_file ->> 'county_id'
  ) then
    raise exception 'a ballot''s precinct is not in the file''s county' using errcode = 'VB422';
  end if;

  insert into private.ingest_files (sha256, kind, actor_id, ballot_count)
  values (p_file ->> 'sha256', p_file ->> 'kind', p_file ->> 'actor_id', (p_file ->> 'ballot_count')::integer)
  returning id into v_file_id;

  -- New ballots and their CAST events, set-based. A tracking code inserted meanwhile by another upload
  -- fails the unique constraint and rolls everything back.
  with incoming as (
    select *
    from jsonb_to_recordset(coalesce(p_file -> 'ballots', '[]'::jsonb)) as x (
      tracking_code text, prev_tracking_code text, ciphertext text, ciphertext_hash text,
      ballot_style text, precinct_id text, machine_id text, cast_date date,
      occurred_at timestamptz, actor_role text, actor_id text, hash text
    )
  ),
  inserted as (
    insert into private.ballots (
      tracking_code, prev_tracking_code, ciphertext, ciphertext_hash, ballot_style,
      precinct_id, machine_id, cast_date
    )
    select tracking_code, prev_tracking_code, ciphertext, ciphertext_hash, ballot_style,
      precinct_id, machine_id, cast_date
    from incoming
    returning id, tracking_code, precinct_id
  ),
  cast_events as (
    insert into private.ballot_events (
      ballot_id, precinct_id, county_id, event_type, from_status, to_status,
      actor_role, actor_id, occurred_at, prev_hash, hash
    )
    select i.id, i.precinct_id, p.county_id, 'CAST', null, null,
      n.actor_role, n.actor_id, n.occurred_at, null, n.hash
    from inserted i
    join incoming n on n.tracking_code = i.tracking_code
    join public.precincts p on p.id = i.precinct_id
    returning id
  )
  select coalesce(array_agg(id), '{}') into v_event_ids from cast_events;

  -- Mismatches: the stored ciphertext is never changed; events chain onto the current head.
  for v_mismatch in select * from jsonb_array_elements(coalesce(p_file -> 'mismatches', '[]'::jsonb)) loop
    select b.id, b.current_status, b.ciphertext_hash, b.precinct_id, p.county_id
    into v_ballot
    from private.ballots b
    join public.precincts p on p.id = b.precinct_id
    where b.tracking_code = v_mismatch ->> 'tracking_code'
    for update of b;

    if not found
      or v_ballot.current_status is distinct from v_mismatch ->> 'expected_status'
      or v_ballot.ciphertext_hash = v_mismatch ->> 'ciphertext_hash' then
      raise exception 'a mismatched ballot changed during the upload' using errcode = 'VB409';
    end if;

    select h.head_hash, h.heads into v_head from private.chain_heads_for(array[v_ballot.id]) h;
    if coalesce(v_head.heads, 0) > 1
      or v_head.head_hash is distinct from (v_mismatch -> 'events' -> 0 ->> 'prev_hash') then
      raise exception 'a mismatched ballot''s chain head changed during the upload' using errcode = 'VB409';
    end if;

    if exists (
      select 1 from jsonb_array_elements(v_mismatch -> 'events') x
      where x ->> 'event_type' = 'STATUS_CHANGE' and x ->> 'from_status' is distinct from v_ballot.current_status
    ) then
      raise exception 'a mismatch event does not start from the ballot''s status' using errcode = 'VB409';
    end if;

    for v_event in select * from jsonb_array_elements(v_mismatch -> 'events') loop
      insert into private.ballot_events (
        ballot_id, precinct_id, county_id, event_type, from_status, to_status, reason,
        actor_role, actor_id, occurred_at, prev_hash, hash
      ) values (
        v_ballot.id, v_ballot.precinct_id, v_ballot.county_id,
        v_event ->> 'event_type', v_event ->> 'from_status', v_event ->> 'to_status', v_event ->> 'reason',
        v_event ->> 'actor_role', v_event ->> 'actor_id', (v_event ->> 'occurred_at')::timestamptz,
        v_event ->> 'prev_hash', v_event ->> 'hash'
      )
      returning id into v_event_id;
      v_event_ids := v_event_ids || v_event_id;
    end loop;

    update private.ballots
    set mismatch = true,
        current_status = coalesce(v_mismatch ->> 'new_status', current_status)
    where id = v_ballot.id;
  end loop;

  return jsonb_build_object('file_id', v_file_id, 'event_ids', to_jsonb(v_event_ids));
end;
$$;

-- ---------------------------------------------------------------------------------------------------
-- batch_members(scope, scope_id, from_status): the ballots a batch would move (C12), with what the
-- caller needs to build their events, Merkle tree and totals. Ordered by ciphertext hash, never by
-- cast order. Returns a jsonb array.
-- ---------------------------------------------------------------------------------------------------

create function public.batch_members(p_scope text, p_scope_id text, p_from_status text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_result jsonb;
begin
  if p_scope not in ('precinct', 'county') then
    raise exception 'unknown batch scope' using errcode = 'VB422';
  end if;

  with members as (
    select b.id, b.tracking_code, b.ciphertext, b.ciphertext_hash, b.precinct_id, p.county_id
    from private.ballots b
    join public.precincts p on p.id = b.precinct_id
    where b.current_status = p_from_status
      and case p_scope when 'precinct' then b.precinct_id = p_scope_id else p.county_id = p_scope_id end
  )
  select coalesce(jsonb_agg(jsonb_build_object(
      'ballot_id', m.id,
      'tracking_code', m.tracking_code,
      'ciphertext', m.ciphertext,
      'ciphertext_hash', m.ciphertext_hash,
      'precinct_id', m.precinct_id,
      'county_id', m.county_id,
      'head_hash', h.head_hash,
      'heads', coalesce(h.heads, 0)
    ) order by m.ciphertext_hash, m.tracking_code), '[]'::jsonb)
  into v_result
  from members m
  left join private.chain_heads_for(array(select id from members)) h on h.ballot_id = m.id;
  return v_result;
end;
$$;

-- ---------------------------------------------------------------------------------------------------
-- apply_batch(batch): one batch transition, atomically (C11, C16).
--
-- {
--   "batch_id": uuid, "scope": "precinct" | "county", "scope_id": "...",
--   "from_status": "...", "to_status": "...", "actor_role": "...", "actor_id": "...",
--   "occurred_at": timestamptz,
--   "events": [{ ballot_id, prev_hash, hash }],
--   "stage_record": { merkle_root, ballot_count, totals, signature }
-- }
-- Locks every member ballot (in id order, so concurrent batches cannot deadlock), then checks that
-- the locked membership is exactly the payload's, that each ballot still holds from_status and that
-- its chain head is still the event's prev_hash. Then it writes the batch, one STATUS_CHANGE per
-- ballot, the new statuses and the stage record (stage_records.id = batches.id). Returns
-- { batch_id, stage_record_id, ballot_count }.
-- ---------------------------------------------------------------------------------------------------

create function public.apply_batch(p_batch jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_batch_id uuid := (p_batch ->> 'batch_id')::uuid;
  v_scope text := p_batch ->> 'scope';
  v_scope_id text := p_batch ->> 'scope_id';
  v_from text := p_batch ->> 'from_status';
  v_to text := p_batch ->> 'to_status';
  v_ids uuid[];
  v_locked uuid[];
  v_count integer;
begin
  if v_scope is null or v_scope not in ('precinct', 'county') then
    raise exception 'unknown batch scope' using errcode = 'VB422';
  end if;

  select coalesce(array_agg(distinct (x ->> 'ballot_id')::uuid order by (x ->> 'ballot_id')::uuid), '{}'),
         count(*)::integer
  into v_ids, v_count
  from jsonb_array_elements(coalesce(p_batch -> 'events', '[]'::jsonb)) x;

  if v_count = 0 then
    raise exception 'a batch needs at least one ballot' using errcode = 'VB422';
  end if;
  if cardinality(v_ids) <> v_count
    or (p_batch -> 'stage_record' ->> 'ballot_count')::integer is distinct from v_count then
    raise exception 'the batch payload does not list each ballot once' using errcode = 'VB422';
  end if;

  -- Lock the payload's ballots and every ballot that belongs to the batch now.
  select coalesce(array_agg(l.id order by l.id), '{}')
  into v_locked
  from (
    select b.id
    from private.ballots b
    join public.precincts p on p.id = b.precinct_id
    where b.id = any (v_ids)
       or (b.current_status = v_from
           and case v_scope when 'precinct' then b.precinct_id = v_scope_id else p.county_id = v_scope_id end)
    order by b.id
    for update of b
  ) l;

  if v_locked is distinct from v_ids then
    raise exception 'the batch''s ballots changed since they were read' using errcode = 'VB409';
  end if;

  if exists (
    select 1
    from private.ballots b
    join public.precincts p on p.id = b.precinct_id
    where b.id = any (v_ids)
      and not (b.current_status = v_from
               and case v_scope when 'precinct' then b.precinct_id = v_scope_id else p.county_id = v_scope_id end)
  ) then
    raise exception 'a ballot in the batch no longer has the batch''s status or scope' using errcode = 'VB409';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(p_batch -> 'events') x
    left join private.chain_heads_for(v_ids) h on h.ballot_id = (x ->> 'ballot_id')::uuid
    where coalesce(h.heads, 0) > 1 or h.head_hash is distinct from x ->> 'prev_hash'
  ) then
    raise exception 'a ballot''s chain head changed since it was read' using errcode = 'VB409';
  end if;

  insert into public.batches (id, scope, scope_id, from_status, to_status, actor_id, ballot_count)
  values (v_batch_id, v_scope, v_scope_id, v_from, v_to, p_batch ->> 'actor_id', v_count);

  insert into private.ballot_events (
    ballot_id, precinct_id, county_id, event_type, from_status, to_status,
    actor_role, actor_id, batch_id, occurred_at, prev_hash, hash
  )
  select b.id, b.precinct_id, p.county_id, 'STATUS_CHANGE', v_from, v_to,
    p_batch ->> 'actor_role', p_batch ->> 'actor_id', v_batch_id, (p_batch ->> 'occurred_at')::timestamptz,
    x.prev_hash, x.hash
  from jsonb_to_recordset(p_batch -> 'events') as x (ballot_id uuid, prev_hash text, hash text)
  join private.ballots b on b.id = x.ballot_id
  join public.precincts p on p.id = b.precinct_id;

  update private.ballots set current_status = v_to where id = any (v_ids);

  insert into public.stage_records (id, scope, scope_id, stage, merkle_root, ballot_count, totals, signature)
  values (
    v_batch_id, v_scope, v_scope_id, v_to,
    p_batch -> 'stage_record' ->> 'merkle_root',
    v_count,
    p_batch -> 'stage_record' -> 'totals',
    p_batch -> 'stage_record' ->> 'signature'
  );

  return jsonb_build_object('batch_id', v_batch_id, 'stage_record_id', v_batch_id, 'ballot_count', v_count);
end;
$$;

-- ---------------------------------------------------------------------------------------------------
-- Grants: service_role only. Supabase's default privileges grant execute on new public functions to
-- the API roles, so start from nothing.
-- ---------------------------------------------------------------------------------------------------

revoke all on function public.chain_heads(text[]) from public, anon, authenticated, service_role;
revoke all on function public.ingest_ballot_record(jsonb) from public, anon, authenticated, service_role;
revoke all on function public.batch_members(text, text, text) from public, anon, authenticated, service_role;
revoke all on function public.apply_batch(jsonb) from public, anon, authenticated, service_role;

grant execute on function public.chain_heads(text[]) to service_role;
grant execute on function public.ingest_ballot_record(jsonb) to service_role;
grant execute on function public.batch_members(text, text, text) to service_role;
grant execute on function public.apply_batch(jsonb) to service_role;
