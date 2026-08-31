-- JSC-0221B durable committed-review QA-preview replay claims v5.
--
-- Each grant_id is a permanent, append-only one-shot tombstone.  The private
-- claim_attempt_id distinguishes an exact retry after an ambiguous COMMIT
-- acknowledgement from a second consumer.  No runtime role receives an
-- UPDATE, DELETE, TRUNCATE, maintenance, or expiry-reuse path.

do $$
begin
  if exists (
    select 1 from pg_catalog.pg_roles
    where rolname = 'jessica_committed_review_qa_preview_replay_claimer'
  ) then
    raise exception 'v5 requires the jessica_committed_review_qa_preview_replay_claimer role name to be unused';
  end if;
end;
$$;

create role jessica_committed_review_qa_preview_replay_claimer
  nosuperuser
  nocreatedb
  nocreaterole
  noinherit
  nologin
  noreplication
  nobypassrls;

create table private.committed_review_qa_preview_replay_claims (
  grant_id private.sha256 primary key,
  claim_attempt_id private.sha256 not null unique,
  expires_at timestamptz not null,
  expires_at_canonical text not null,
  claimed_at timestamptz not null default pg_catalog.clock_timestamp(),
  check (
    expires_at_canonical ~ '^[0-9]{4}-(0[1-9]|1[0-2])-([0-2][0-9]|3[01])T([01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9][.][0-9]{3}Z$'
    and expires_at_canonical::timestamptz = expires_at
  ),
  check (
    claimed_at < expires_at
    and expires_at <= claimed_at + interval '2 minutes'
  )
);

alter table private.committed_review_qa_preview_replay_claims enable row level security;
alter table private.committed_review_qa_preview_replay_claims force row level security;

-- The claimer cannot supply claimed_at: PostgreSQL's clock_timestamp() default
-- is therefore the stored claim authority.  The RLS check independently
-- rechecks both the exclusive expiry boundary and the fixed two-minute cap at
-- statement evaluation time.
create policy committed_review_qa_preview_replay_claimer_insert
  on private.committed_review_qa_preview_replay_claims
  for insert to jessica_committed_review_qa_preview_replay_claimer
  with check (
    claimed_at <= pg_catalog.clock_timestamp()
    and pg_catalog.clock_timestamp() < expires_at
    and expires_at <= pg_catalog.clock_timestamp() + interval '2 minutes'
  );

-- SELECT is limited to the three columns needed to distinguish an exact
-- ambiguous-outcome retry from a different claim.  The adapter rechecks the
-- database clock against its exact bound expiry parameter, while the table
-- CHECK and RLS policy bind that canonical value to the stored instant.  The
-- table contains no
-- tenant, actor, locator, credential, artifact, or signature material.
create policy committed_review_qa_preview_replay_claimer_select
  on private.committed_review_qa_preview_replay_claims
  for select to jessica_committed_review_qa_preview_replay_claimer
  using (true);

revoke all on schema private from jessica_committed_review_qa_preview_replay_claimer;
grant usage on schema private to jessica_committed_review_qa_preview_replay_claimer;

revoke all on table private.committed_review_qa_preview_replay_claims
  from public, anon, authenticated, service_role, jessica_non_proxy_qa_writer,
    jessica_committed_review_qa_preview_reader,
    jessica_committed_review_qa_preview_replay_claimer;

grant insert (grant_id, claim_attempt_id, expires_at, expires_at_canonical)
  on private.committed_review_qa_preview_replay_claims
  to jessica_committed_review_qa_preview_replay_claimer;

grant select (grant_id, claim_attempt_id, expires_at_canonical)
  on private.committed_review_qa_preview_replay_claims
  to jessica_committed_review_qa_preview_replay_claimer;

revoke all on all sequences in schema private
  from jessica_committed_review_qa_preview_replay_claimer;
revoke execute on all functions in schema private
  from jessica_committed_review_qa_preview_replay_claimer;
