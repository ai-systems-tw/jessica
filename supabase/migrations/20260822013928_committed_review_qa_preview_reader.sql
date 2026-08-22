-- JSC-0219 committed-review QA-preview reader v4.
--
-- This is a credentialless, trusted-server role for the pinned PostgreSQL
-- adapter.  Its authority is deliberately limited to SELECT on the ten
-- relations the adapter reads.  It has no API/browser grant, membership,
-- write privilege, sequence privilege, routine privilege, or default/future
-- grant to the reader beyond the exact direct SELECT allowlist below. Future private routines must preserve the repository's
-- explicit PUBLIC-revoke convention; this migration does not alter an owner's
-- global default privileges.  Application authentication and exact predicates
-- remain mandatory because these role-specific RLS policies permit the
-- adapter to read the rows selected by its authoritative queries.

do $$
begin
  if exists (
    select 1 from pg_catalog.pg_roles
    where rolname = 'jessica_committed_review_qa_preview_reader'
  ) then
    raise exception 'v4 requires the jessica_committed_review_qa_preview_reader role name to be unused';
  end if;
end;
$$;

create role jessica_committed_review_qa_preview_reader
  nosuperuser
  nocreatedb
  nocreaterole
  noinherit
  nologin
  noreplication
  nobypassrls;

-- Every status mutation of a committed non-Proxy asset must conflict with the
-- preview reader's session-level candidate lock.  v3 already takes this exact
-- key for review -> approved; this trigger closes approved -> retired (and any
-- other status transition) without relying on the updating role or API path.
create function private.lock_committed_review_qa_preview_candidate_status_change()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'candidate:'
    || pg_catalog.length(old.tenant_id::text)::text || ':' || old.tenant_id::text
    || pg_catalog.length(old.id::text)::text || ':' || old.id::text
    || ':' || old.version::text,
    218
  ));
  return new;
end;
$$;

-- CREATE FUNCTION grants EXECUTE to PUBLIC by default.  The function is a
-- trigger-only synchronization primitive, never an RPC or direct capability.
revoke execute on function private.lock_committed_review_qa_preview_candidate_status_change()
  from public, anon, authenticated, service_role, jessica_non_proxy_qa_writer,
    jessica_committed_review_qa_preview_reader;

create trigger committed_review_qa_preview_candidate_status_lock
before update of status on private.asset_versions
for each row
when (old.non_proxy_internal_review and new.status is distinct from old.status)
execute function private.lock_committed_review_qa_preview_candidate_status_change();

-- Reassert forced RLS on every relation in the allowlist.  The role is not an
-- owner and cannot bypass these policies.
alter table private.asset_versions force row level security;
alter table private.non_proxy_asset_version_bindings force row level security;
alter table private.non_proxy_human_qa_records force row level security;
alter table private.qa_reviewer_authorities force row level security;
alter table private.generation_jobs force row level security;
alter table private.generation_job_events force row level security;
alter table private.measurement_sets force row level security;
alter table private.frame_variants force row level security;
alter table private.asset_version_sources force row level security;
alter table private.source_assets force row level security;

create policy committed_review_qa_preview_reader_assets_select
  on private.asset_versions
  for select to jessica_committed_review_qa_preview_reader using (true);
create policy committed_review_qa_preview_reader_bindings_select
  on private.non_proxy_asset_version_bindings
  for select to jessica_committed_review_qa_preview_reader using (true);
create policy committed_review_qa_preview_reader_reviews_select
  on private.non_proxy_human_qa_records
  for select to jessica_committed_review_qa_preview_reader using (true);
create policy committed_review_qa_preview_reader_authorities_select
  on private.qa_reviewer_authorities
  for select to jessica_committed_review_qa_preview_reader using (true);
create policy committed_review_qa_preview_reader_generation_jobs_select
  on private.generation_jobs
  for select to jessica_committed_review_qa_preview_reader using (true);
create policy committed_review_qa_preview_reader_generation_job_events_select
  on private.generation_job_events
  for select to jessica_committed_review_qa_preview_reader using (true);
create policy committed_review_qa_preview_reader_measurement_sets_select
  on private.measurement_sets
  for select to jessica_committed_review_qa_preview_reader using (true);
create policy committed_review_qa_preview_reader_frame_variants_select
  on private.frame_variants
  for select to jessica_committed_review_qa_preview_reader using (true);
create policy committed_review_qa_preview_reader_asset_sources_select
  on private.asset_version_sources
  for select to jessica_committed_review_qa_preview_reader using (true);
create policy committed_review_qa_preview_reader_source_assets_select
  on private.source_assets
  for select to jessica_committed_review_qa_preview_reader using (true);

revoke all on schema private from jessica_committed_review_qa_preview_reader;
grant usage on schema private to jessica_committed_review_qa_preview_reader;

revoke all on all tables in schema private from jessica_committed_review_qa_preview_reader;
grant select on
  private.asset_versions,
  private.non_proxy_asset_version_bindings,
  private.non_proxy_human_qa_records,
  private.qa_reviewer_authorities,
  private.generation_jobs,
  private.generation_job_events,
  private.measurement_sets,
  private.frame_variants,
  private.asset_version_sources,
  private.source_assets
to jessica_committed_review_qa_preview_reader;

revoke all on all sequences in schema private from jessica_committed_review_qa_preview_reader;
revoke execute on all functions in schema private from jessica_committed_review_qa_preview_reader;
