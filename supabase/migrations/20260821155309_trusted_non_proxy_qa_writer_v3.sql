-- JSC-0218A trusted non-Proxy QA writer v3.
--
-- This migration supplies only the private, append-only facts that a trusted
-- server adapter needs in order to reconstruct GenerationJob output and exact
-- MeasurementSet specimen identity.  It deliberately exposes no RPC, view,
-- SECURITY DEFINER function, credential, membership, or browser/API grant.

do $$
begin
  if exists (select 1 from pg_catalog.pg_roles where rolname = 'jessica_non_proxy_qa_writer') then
    raise exception 'v3 requires the jessica_non_proxy_qa_writer role name to be unused';
  end if;
end;
$$;

create role jessica_non_proxy_qa_writer
  nosuperuser
  nocreatedb
  nocreaterole
  noinherit
  nologin
  noreplication
  nobypassrls;

alter table private.generation_job_events
  add column occurred_at_canonical text,
  add column output_manifest_sha256 private.sha256,
  add column output_manifest_byte_length bigint,
  add column output_model_sha256 private.sha256,
  add column output_model_byte_length bigint,
  add constraint generation_job_events_output_all_or_none_check check (
    (output_manifest_sha256 is null
      and output_manifest_byte_length is null
      and output_model_sha256 is null
      and output_model_byte_length is null)
    or
    (event_type = 'output-recorded'
      and output_manifest_sha256 is not null
      and output_manifest_byte_length > 0
      and output_model_sha256 is not null
      and output_model_byte_length > 0
      and evidence->'output' = jsonb_build_object(
        'manifestSha256', output_manifest_sha256,
        'manifestByteLength', output_manifest_byte_length,
        'modelSha256', output_model_sha256,
        'modelByteLength', output_model_byte_length
      ))
  ),
  -- Existing v1/v2 output-recorded events did not carry canonical output
  -- columns.  They remain explicitly untrusted (all NULL); PostgreSQL checks
  -- this constraint for every new/changed row after v3.
  add constraint generation_job_events_v3_output_required_check check (
    event_type <> 'output-recorded'
    or (output_manifest_sha256 is not null
      and output_manifest_byte_length is not null
      and output_model_sha256 is not null
      and output_model_byte_length is not null)
  ) not valid,
  -- timestamptz preserves an instant, not the caller's exact RFC 3339 bytes.
  -- The canonical spelling is required to recompute the domain event digest.
  -- Legacy rows remain NULL and therefore cannot authorize this writer.
  add constraint generation_job_events_v3_canonical_time_required_check check (
    occurred_at_canonical is not null
    and occurred_at_canonical::timestamptz = occurred_at
  ) not valid;

create function private.is_sorted_unique_sha256_array(values_to_check private.sha256[])
returns boolean language sql immutable strict security invoker set search_path = '' as $$
  select values_to_check = array(
    select distinct value from unnest(values_to_check) value order by value
  );
$$;
revoke execute on function private.is_sorted_unique_sha256_array(private.sha256[])
  from public, anon, authenticated, service_role, jessica_non_proxy_qa_writer;

alter table private.generation_jobs
  add column source_asset_sha256s private.sha256[],
  add constraint generation_jobs_v3_source_set_required_check check (
    source_asset_sha256s is not null
    and cardinality(source_asset_sha256s) between 1 and 32
    and private.is_sorted_unique_sha256_array(source_asset_sha256s)
  ) not valid,
  -- One attempt can contribute claimed/failed/retry-queued events. This v3
  -- bound gives complete replay a shared finite database/application budget.
  add constraint generation_jobs_v3_max_attempts_check check (
    max_attempts between 1 and 64
  ) not valid;

alter table private.measurement_sets
  add column specimen_id private.identifier,
  -- Legacy verified sets have no trusted specimen identity and therefore
  -- remain unusable by the v3 writer.  New verified rows must identify one.
  add constraint measurement_sets_v3_verified_specimen_required_check check (
    status <> 'verified' or specimen_id is not null
  ) not valid,
  add constraint measurement_sets_exact_specimen_identity_unique
    unique (tenant_id, id, frame_model_id, evidence_sha256, specimen_id);

alter table private.qa_reviewer_authorities
  add column created_at_canonical text,
  -- Reviewer-authority row identities include the exact RFC 3339 spelling.
  -- Legacy authorities remain unusable until externally re-registered under
  -- the v3 contract; this writer never repairs or registers trust roots.
  add constraint qa_reviewer_authorities_v3_canonical_time_required_check check (
    created_at_canonical is not null
    and created_at_canonical::timestamptz = created_at
  ) not valid;

alter table private.non_proxy_human_qa_records
  add column reviewed_at_canonical text,
  add column issued_at_canonical text,
  add column expires_at_canonical text,
  add column input_valid_until_canonical text,
  add column review_fresh_until_canonical text,
  add column effective_valid_until_canonical text,
  add column writer_committed_at timestamptz,
  add column writer_committed_at_canonical text,
  -- These strings are part of the canonical row/signature projections. The
  -- corresponding timestamptz columns alone cannot reproduce their bytes.
  add constraint non_proxy_human_qa_v3_canonical_times_required_check check (
    reviewed_at_canonical is not null and reviewed_at_canonical::timestamptz = reviewed_at
    and issued_at_canonical is not null and issued_at_canonical::timestamptz = issued_at
    and expires_at_canonical is not null and expires_at_canonical::timestamptz = expires_at
    and input_valid_until_canonical is not null and input_valid_until_canonical::timestamptz = input_valid_until
    and review_fresh_until_canonical is not null and review_fresh_until_canonical::timestamptz = review_fresh_until
    and effective_valid_until_canonical is not null and effective_valid_until_canonical::timestamptz = effective_valid_until
    and writer_committed_at is not null
    and writer_committed_at_canonical is not null
    and writer_committed_at_canonical::timestamptz = writer_committed_at
  ) not valid;

-- A candidate version has exactly one terminal human-QA decision across all
-- GenerationJobs.  The v2 key included generation_job_id and therefore could
-- admit contradictory terminal rows for the same candidate identity.
alter table private.non_proxy_human_qa_records
  add constraint non_proxy_human_qa_candidate_terminal_unique
  unique (tenant_id, candidate_asset_version_id, candidate_version);

alter table private.non_proxy_human_qa_records
  add constraint non_proxy_human_qa_measurement_specimen_exact_fkey
  foreign key (tenant_id, measurement_set_id, frame_model_id, measurement_set_sha256, specimen_id)
  references private.measurement_sets(tenant_id, id, frame_model_id, evidence_sha256, specimen_id)
  not valid;

-- The v2 invariant triggers acquired generation-job (and, for bindings, asset)
-- row locks with FOR UPDATE.  PostgreSQL requires table UPDATE privilege for
-- that lock mode even when the trigger itself is reached through an otherwise
-- permitted INSERT.  The writer must not receive those broad UPDATE grants.
--
-- Recreate only the five writer-invoked functions without row-lock clauses;
-- those clauses also require UPDATE privilege. Each validator instead acquires
-- the same transaction-advisory keys as its mutation counterparts, in the
-- canonical authority -> candidate -> job order, before authoritative reads.
-- Locator reads below obtain only immutable IDs needed to form those keys; the
-- original validator then rereads all authoritative state after the locks.
-- Deriving the replacement from the installed v2 definition guarantees every
-- other invariant and exception branch remains byte-for-byte unchanged.  Exact
-- occurrence counts make an unexpected prior definition fail the migration.
do $$
declare
  function_name text;
  expected_update_locks integer;
  expected_share_locks integer;
  definition text;
  actual_update_locks integer;
  actual_share_locks integer;
  begin_markers integer;
  declare_markers integer;
  expected_advisory_locks integer;
  actual_advisory_locks integer;
begin
  for function_name, expected_update_locks, expected_share_locks in
    select * from unnest(
      array[
        'validate_non_proxy_human_qa_record',
        'validate_non_proxy_binding',
        'validate_asset_version_source_insert',
        'validate_asset_insert',
        'validate_asset_update'
      ]::text[],
      array[1, 2, 0, 1, 1]::integer[],
      array[2, 2, 2, 2, 3]::integer[]
    )
  loop
    select pg_catalog.pg_get_functiondef(
      pg_catalog.to_regprocedure('private.' || function_name || '()')
    ) into strict definition;
    actual_update_locks := (
      length(definition) - length(replace(definition, 'for update;', ''))
    ) / length('for update;');
    actual_share_locks := (
      length(definition) - length(replace(definition, 'for share;', ''))
    ) / length('for share;');
    if actual_update_locks <> expected_update_locks
      or actual_share_locks <> expected_share_locks then
      raise exception 'v3 lock rewrite refused unexpected prior function definition';
    end if;
    definition := replace(replace(definition, 'for update;', ';'), 'for share;', ';');
    begin_markers := (
      length(definition) - length(replace(definition, E'begin\n', ''))
    ) / length(E'begin\n');
    declare_markers := (
      length(definition) - length(replace(definition, E'declare\n', ''))
    ) / length(E'declare\n');
    if begin_markers <> 1 or declare_markers <> 1 then
      raise exception 'v3 advisory prologue rewrite refused unexpected function structure';
    end if;

    case function_name
      when 'validate_non_proxy_human_qa_record' then
        definition := replace(definition, E'begin\n', E'begin\n'
          || $lock$  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'authority:' || pg_catalog.length(new.tenant_id::text)::text || ':' || new.tenant_id::text
      || pg_catalog.length(new.reviewer_authority_id::text)::text || ':' || new.reviewer_authority_id::text
      || pg_catalog.length(new.reviewer_key_id::text)::text || ':' || new.reviewer_key_id::text, 218));
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'candidate:' || pg_catalog.length(new.tenant_id::text)::text || ':' || new.tenant_id::text
      || pg_catalog.length(new.candidate_asset_version_id::text)::text || ':' || new.candidate_asset_version_id::text
      || ':' || new.candidate_version::text, 218));
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'job:' || pg_catalog.length(new.tenant_id::text)::text || ':' || new.tenant_id::text
      || pg_catalog.length(new.generation_job_id::text)::text || ':' || new.generation_job_id::text, 218));
$lock$);

      when 'validate_non_proxy_binding' then
        definition := replace(definition, E'declare\n', E'declare\n'
          || $decl$  v3_lock_authority_id text;
  v3_lock_key_id text;
  v3_lock_candidate_id text;
  v3_lock_candidate_version integer;
  v3_lock_job_id text;
$decl$);
        definition := replace(definition, E'begin\n', E'begin\n'
          || $lock$  select reviewer_authority_id::text, reviewer_key_id::text,
      candidate_asset_version_id::text, candidate_version, generation_job_id::text
    into strict v3_lock_authority_id, v3_lock_key_id,
      v3_lock_candidate_id, v3_lock_candidate_version, v3_lock_job_id
    from private.non_proxy_human_qa_records
    where tenant_id = new.tenant_id and id = new.review_record_id;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'authority:' || pg_catalog.length(new.tenant_id::text)::text || ':' || new.tenant_id::text
      || pg_catalog.length(v3_lock_authority_id)::text || ':' || v3_lock_authority_id
      || pg_catalog.length(v3_lock_key_id)::text || ':' || v3_lock_key_id, 218));
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'candidate:' || pg_catalog.length(new.tenant_id::text)::text || ':' || new.tenant_id::text
      || pg_catalog.length(v3_lock_candidate_id)::text || ':' || v3_lock_candidate_id
      || ':' || v3_lock_candidate_version::text, 218));
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'job:' || pg_catalog.length(new.tenant_id::text)::text || ':' || new.tenant_id::text
      || pg_catalog.length(v3_lock_job_id)::text || ':' || v3_lock_job_id, 218));
$lock$);

      when 'validate_asset_version_source_insert' then
        definition := replace(definition, E'declare\n', E'declare\n'
          || $decl$  v3_lock_candidate_version integer;
$decl$);
        definition := replace(definition, E'begin\n', E'begin\n'
          || $lock$  select version into strict v3_lock_candidate_version
    from private.asset_versions
    where tenant_id = new.tenant_id and id = new.asset_version_id;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'candidate:' || pg_catalog.length(new.tenant_id::text)::text || ':' || new.tenant_id::text
      || pg_catalog.length(new.asset_version_id::text)::text || ':' || new.asset_version_id::text
      || ':' || v3_lock_candidate_version::text, 218));
$lock$);

      when 'validate_asset_insert' then
        definition := replace(definition, E'declare\n', E'declare\n'
          || $decl$  v3_lock_authority_id text;
  v3_lock_key_id text;
$decl$);
        definition := replace(definition, E'begin\n', E'begin\n'
          || $lock$  if new.non_proxy_internal_review then
    select reviewer_authority_id::text, reviewer_key_id::text
      into strict v3_lock_authority_id, v3_lock_key_id
      from private.non_proxy_human_qa_records
      where tenant_id = new.tenant_id
        and candidate_asset_version_id = new.id
        and candidate_version = new.version
        and generation_job_id = new.generation_job_id;
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
      'authority:' || pg_catalog.length(new.tenant_id::text)::text || ':' || new.tenant_id::text
        || pg_catalog.length(v3_lock_authority_id)::text || ':' || v3_lock_authority_id
        || pg_catalog.length(v3_lock_key_id)::text || ':' || v3_lock_key_id, 218));
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
      'candidate:' || pg_catalog.length(new.tenant_id::text)::text || ':' || new.tenant_id::text
        || pg_catalog.length(new.id::text)::text || ':' || new.id::text
        || ':' || new.version::text, 218));
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
      'job:' || pg_catalog.length(new.tenant_id::text)::text || ':' || new.tenant_id::text
        || pg_catalog.length(new.generation_job_id::text)::text || ':' || new.generation_job_id::text, 218));
  end if;
$lock$);

      when 'validate_asset_update' then
        definition := replace(definition, E'declare\n', E'declare\n'
          || $decl$  v3_lock_authority_id text;
  v3_lock_key_id text;
  v3_lock_job_id text;
$decl$);
        definition := replace(definition, E'begin\n', E'begin\n'
          || $lock$  if old.status = 'review' and new.status = 'approved'
      and old.quality in ('standard','premium') then
    select review.reviewer_authority_id::text, review.reviewer_key_id::text,
        review.generation_job_id::text
      into strict v3_lock_authority_id, v3_lock_key_id, v3_lock_job_id
      from private.non_proxy_asset_version_bindings binding
      join private.non_proxy_human_qa_records review
        on review.tenant_id = binding.tenant_id and review.id = binding.review_record_id
      where binding.tenant_id = old.tenant_id and binding.asset_version_id = old.id;
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
      'authority:' || pg_catalog.length(old.tenant_id::text)::text || ':' || old.tenant_id::text
        || pg_catalog.length(v3_lock_authority_id)::text || ':' || v3_lock_authority_id
        || pg_catalog.length(v3_lock_key_id)::text || ':' || v3_lock_key_id, 218));
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
      'candidate:' || pg_catalog.length(old.tenant_id::text)::text || ':' || old.tenant_id::text
        || pg_catalog.length(old.id::text)::text || ':' || old.id::text
        || ':' || old.version::text, 218));
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
      'job:' || pg_catalog.length(old.tenant_id::text)::text || ':' || old.tenant_id::text
        || pg_catalog.length(v3_lock_job_id)::text || ':' || v3_lock_job_id, 218));
  end if;
$lock$);
    end case;

    expected_advisory_locks := case
      when function_name = 'validate_asset_version_source_insert' then 1
      else 3
    end;
    actual_advisory_locks := (
      length(definition) - length(replace(definition, 'pg_advisory_xact_lock', ''))
    ) / length('pg_advisory_xact_lock');
    if actual_advisory_locks <> expected_advisory_locks then
      raise exception 'v3 advisory prologue rewrite produced an unexpected lock matrix';
    end if;

    execute definition;
  end loop;
end;
$$;

create or replace function private.validate_generation_event_chain()
returns trigger language plpgsql set search_path = '' as $$
declare prior private.generation_job_events%rowtype;
begin
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'job:' || pg_catalog.length(new.tenant_id::text)::text || ':' || new.tenant_id::text
        || pg_catalog.length(new.generation_job_id::text)::text || ':' || new.generation_job_id::text,
      218
    )
  );
  perform 1 from private.generation_jobs where tenant_id = new.tenant_id and id = new.generation_job_id for update;
  if new.sequence = 1 then
    if new.event_type <> 'queued' then raise exception 'first generation event must be queued'; end if;
  else
    select * into strict prior from private.generation_job_events
      where tenant_id = new.tenant_id and generation_job_id = new.generation_job_id and sequence = new.sequence - 1;
    if new.previous_event_sha256 <> prior.event_sha256 or new.occurred_at <= prior.occurred_at then
      raise exception 'generation event lineage must be hash-bound and monotonic';
    end if;
  end if;
  return new;
end;
$$;

create function private.lock_non_proxy_qa_authority_change()
returns trigger language plpgsql set search_path = '' as $$
begin
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'authority:' || pg_catalog.length(new.tenant_id::text)::text || ':' || new.tenant_id::text
        || pg_catalog.length(new.authority_id::text)::text || ':' || new.authority_id::text
        || pg_catalog.length(new.key_id::text)::text || ':' || new.key_id::text,
      218
    )
  );
  return new;
end;
$$;

create trigger qa_reviewer_authority_v3_advisory_lock
before insert or update on private.qa_reviewer_authorities
for each row execute function private.lock_non_proxy_qa_authority_change();

-- Object grants alone cannot distinguish the JSC-0218A mutation path from an
-- ordinary draft insert or an unrelated status transition. These invoker
-- guards add a role-specific relational boundary without adding an RPC,
-- SECURITY DEFINER escape hatch, credential, membership, or permissive policy.
create function private.guard_non_proxy_qa_writer_review_insert()
returns trigger language plpgsql security invoker set search_path = '' as $$
declare job private.generation_jobs%rowtype;
begin
  -- validate_non_proxy_human_qa_record runs first by trigger-name order and
  -- already holds authority -> candidate -> job before this collision read.
  if exists (
    select 1 from private.non_proxy_human_qa_records existing
    where existing.tenant_id = new.tenant_id
      and existing.candidate_asset_version_id = new.candidate_asset_version_id
      and existing.candidate_version = new.candidate_version
      and (existing.id <> new.id or existing.generation_job_id <> new.generation_job_id)
  ) then
    raise exception 'candidate identity already has a different terminal review';
  end if;
  if current_user <> 'jessica_non_proxy_qa_writer' then return new; end if;
  select * into strict job from private.generation_jobs
    where tenant_id = new.tenant_id and id = new.generation_job_id;
  if new.id is distinct from ('nqhr_' || pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(
      '{"candidateAssetVersionId":"' || new.candidate_asset_version_id::text
      || '","candidateVersion":' || new.candidate_version::text
      || ',"decisionPayloadSha256":"' || new.decision_payload_sha256::text
      || '","domain":"jessica/non-proxy-qa/terminal-review-identity/v1"'
      || ',"generationJobId":"' || new.generation_job_id::text
      || '","tenantId":"' || new.tenant_id::text || '"}', 'UTF8')), 'hex'))
    or job.frame_model_id is distinct from new.frame_model_id
    or job.canonical_input_sha256 is distinct from new.canonical_input_sha256
    or job.generator_input_sha256 is distinct from new.generator_input_sha256
    or job.measurement_set_sha256 is distinct from new.measurement_set_sha256
    or job.source_asset_sha256s is distinct from new.source_asset_sha256s
    or new.signed_schema_version is distinct from 1
    or new.signed_type is distinct from 'non-proxy-human-qa-decision-attestation'
    or new.signed_algorithm is distinct from 'ES256'
    or new.signed_scope is distinct from 'non-proxy-human-qa-decision'
    or new.rights_scope is distinct from 'internal-review-only'
    or not new.terminal then
    raise exception 'writer review insert is outside the exact JSC-0218A path';
  end if;
  return new;
end;
$$;

create function private.guard_non_proxy_qa_writer_asset_insert()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  if current_user = 'jessica_non_proxy_qa_writer'
    and (not new.non_proxy_internal_review or new.status <> 'review'
      or new.rights_scope is distinct from 'internal-review-only'
      or new.recommended_for_live or new.publication_eligible
      or new.persistence_row_sha256 is null) then
    raise exception 'writer asset insert is outside the exact JSC-0218A path';
  end if;
  return new;
end;
$$;

create function private.guard_non_proxy_qa_writer_source_insert()
returns trigger language plpgsql security invoker set search_path = '' as $$
declare asset private.asset_versions%rowtype;
begin
  if current_user <> 'jessica_non_proxy_qa_writer' then return new; end if;
  select * into strict asset from private.asset_versions
    where tenant_id = new.tenant_id and id = new.asset_version_id;
  if not asset.non_proxy_internal_review or asset.status <> 'review'
    or new.persistence_source_row_id is null
    or new.persistence_source_row_sha256 is null
    or new.frame_model_id is distinct from asset.frame_model_id
    or new.frame_variant_id is distinct from asset.frame_variant_id then
    raise exception 'writer source insert is outside the exact JSC-0218A path';
  end if;
  return new;
end;
$$;

create function private.guard_non_proxy_qa_writer_binding_insert()
returns trigger language plpgsql security invoker set search_path = '' as $$
declare asset private.asset_versions%rowtype;
begin
  if current_user <> 'jessica_non_proxy_qa_writer' then return new; end if;
  select * into strict asset from private.asset_versions
    where tenant_id = new.tenant_id and id = new.asset_version_id;
  if not asset.non_proxy_internal_review or asset.status <> 'review'
    or new.id is distinct from ('nqab_' || new.row_sha256)
    or new.frame_model_id is distinct from asset.frame_model_id
    or new.frame_variant_id is distinct from asset.frame_variant_id
    or new.generation_job_id is distinct from asset.generation_job_id
    or new.asset_version_row_sha256 is distinct from asset.persistence_row_sha256
    or new.rights_scope is distinct from 'internal-review-only'
    or new.recommended_for_live or new.publication_eligible then
    raise exception 'writer binding insert is outside the exact JSC-0218A path';
  end if;
  return new;
end;
$$;

create function private.guard_non_proxy_qa_writer_asset_update()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  if current_user = 'jessica_non_proxy_qa_writer'
    and (not old.non_proxy_internal_review or old.status <> 'review'
      or new.status <> 'approved'
      or (to_jsonb(new) - 'status') is distinct from (to_jsonb(old) - 'status')) then
    raise exception 'writer asset update is outside the exact JSC-0218A path';
  end if;
  return new;
end;
$$;

create trigger non_proxy_qa_writer_review_insert_guard
before insert on private.non_proxy_human_qa_records
for each row execute function private.guard_non_proxy_qa_writer_review_insert();
create trigger non_proxy_qa_writer_asset_insert_guard
before insert on private.asset_versions
for each row execute function private.guard_non_proxy_qa_writer_asset_insert();
create trigger non_proxy_qa_writer_source_insert_guard
before insert on private.asset_version_sources
for each row execute function private.guard_non_proxy_qa_writer_source_insert();
create trigger non_proxy_qa_writer_binding_insert_guard
before insert on private.non_proxy_asset_version_bindings
for each row execute function private.guard_non_proxy_qa_writer_binding_insert();
create trigger non_proxy_qa_writer_asset_update_guard
before update on private.asset_versions
for each row execute function private.guard_non_proxy_qa_writer_asset_update();

-- CREATE FUNCTION grants EXECUTE to PUBLIC by default. Revoke both direct and
-- inherited execution from every API/server role, including the trigger role.
revoke execute on function private.validate_non_proxy_human_qa_record() from public, anon, authenticated, service_role, jessica_non_proxy_qa_writer;
revoke execute on function private.validate_non_proxy_binding() from public, anon, authenticated, service_role, jessica_non_proxy_qa_writer;
revoke execute on function private.validate_asset_version_source_insert() from public, anon, authenticated, service_role, jessica_non_proxy_qa_writer;
revoke execute on function private.validate_asset_insert() from public, anon, authenticated, service_role, jessica_non_proxy_qa_writer;
revoke execute on function private.validate_asset_update() from public, anon, authenticated, service_role, jessica_non_proxy_qa_writer;
revoke execute on function private.validate_generation_event_chain() from public, anon, authenticated, service_role, jessica_non_proxy_qa_writer;
revoke execute on function private.lock_non_proxy_qa_authority_change() from public, anon, authenticated, service_role, jessica_non_proxy_qa_writer;
revoke execute on function private.guard_non_proxy_qa_writer_review_insert() from public, anon, authenticated, service_role, jessica_non_proxy_qa_writer;
revoke execute on function private.guard_non_proxy_qa_writer_asset_insert() from public, anon, authenticated, service_role, jessica_non_proxy_qa_writer;
revoke execute on function private.guard_non_proxy_qa_writer_source_insert() from public, anon, authenticated, service_role, jessica_non_proxy_qa_writer;
revoke execute on function private.guard_non_proxy_qa_writer_binding_insert() from public, anon, authenticated, service_role, jessica_non_proxy_qa_writer;
revoke execute on function private.guard_non_proxy_qa_writer_asset_update() from public, anon, authenticated, service_role, jessica_non_proxy_qa_writer;

-- The credentialless writer remains subject to forced RLS.  Its policy surface
-- exactly mirrors the object grants below; API roles receive no new policy.
alter table private.generation_jobs force row level security;
alter table private.generation_job_events force row level security;
alter table private.measurement_sets force row level security;
alter table private.source_assets force row level security;
alter table private.qa_reviewer_authorities force row level security;
alter table private.non_proxy_human_qa_records force row level security;
alter table private.asset_versions force row level security;
alter table private.asset_version_sources force row level security;
alter table private.non_proxy_asset_version_bindings force row level security;

create policy non_proxy_qa_writer_generation_jobs_select on private.generation_jobs
  for select to jessica_non_proxy_qa_writer using (true);
create policy non_proxy_qa_writer_generation_job_events_select on private.generation_job_events
  for select to jessica_non_proxy_qa_writer using (true);
create policy non_proxy_qa_writer_measurement_sets_select on private.measurement_sets
  for select to jessica_non_proxy_qa_writer using (true);
create policy non_proxy_qa_writer_source_assets_select on private.source_assets
  for select to jessica_non_proxy_qa_writer using (true);
create policy non_proxy_qa_writer_authorities_select on private.qa_reviewer_authorities
  for select to jessica_non_proxy_qa_writer using (true);
create policy non_proxy_qa_writer_reviews_select on private.non_proxy_human_qa_records
  for select to jessica_non_proxy_qa_writer using (true);
create policy non_proxy_qa_writer_assets_select on private.asset_versions
  for select to jessica_non_proxy_qa_writer using (true);
create policy non_proxy_qa_writer_sources_select on private.asset_version_sources
  for select to jessica_non_proxy_qa_writer using (true);
create policy non_proxy_qa_writer_bindings_select on private.non_proxy_asset_version_bindings
  for select to jessica_non_proxy_qa_writer using (true);

create policy non_proxy_qa_writer_reviews_insert on private.non_proxy_human_qa_records
  for insert to jessica_non_proxy_qa_writer with check (
    terminal and signed_schema_version = 1
    and signed_type = 'non-proxy-human-qa-decision-attestation'
    and signed_algorithm = 'ES256'
    and signed_scope = 'non-proxy-human-qa-decision'
    and rights_scope = 'internal-review-only'
  );
create policy non_proxy_qa_writer_assets_insert on private.asset_versions
  for insert to jessica_non_proxy_qa_writer with check (
    non_proxy_internal_review and status = 'review'
    and rights_scope = 'internal-review-only'
    and not recommended_for_live and not publication_eligible
  );
create policy non_proxy_qa_writer_sources_insert on private.asset_version_sources
  for insert to jessica_non_proxy_qa_writer with check (
    persistence_source_row_id is not null and persistence_source_row_sha256 is not null
  );
create policy non_proxy_qa_writer_bindings_insert on private.non_proxy_asset_version_bindings
  for insert to jessica_non_proxy_qa_writer with check (
    rights_scope = 'internal-review-only'
    and not recommended_for_live and not publication_eligible
  );
create policy non_proxy_qa_writer_assets_update on private.asset_versions
  for update to jessica_non_proxy_qa_writer
  using (non_proxy_internal_review and status = 'review' and rights_scope = 'internal-review-only')
  with check (non_proxy_internal_review and status = 'approved' and rights_scope = 'internal-review-only'
    and not recommended_for_live and not publication_eligible);

revoke all on schema private from jessica_non_proxy_qa_writer;
grant usage on schema private to jessica_non_proxy_qa_writer;

revoke all on all tables in schema private from jessica_non_proxy_qa_writer;
grant select on
  private.generation_jobs,
  private.generation_job_events,
  private.measurement_sets,
  private.source_assets,
  private.qa_reviewer_authorities,
  private.non_proxy_human_qa_records,
  private.asset_versions,
  private.asset_version_sources,
  private.non_proxy_asset_version_bindings
to jessica_non_proxy_qa_writer;

grant insert on
  private.non_proxy_human_qa_records,
  private.asset_versions,
  private.asset_version_sources,
  private.non_proxy_asset_version_bindings
to jessica_non_proxy_qa_writer;

grant update (status) on private.asset_versions to jessica_non_proxy_qa_writer;

revoke all on all sequences in schema private from jessica_non_proxy_qa_writer;
revoke execute on all functions in schema private from jessica_non_proxy_qa_writer;
