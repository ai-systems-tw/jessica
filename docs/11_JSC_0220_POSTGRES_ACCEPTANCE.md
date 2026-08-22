# JSC-0220 implementation of the JSC-0219B PostgreSQL 17 acceptance harness

## Accepted evidence

The dedicated job
[96973627205](https://github.com/ai-systems-tw/jessica/actions/runs/32549436572/job/96973627205)
in run [32549436572](https://github.com/ai-systems-tw/jessica/actions/runs/32549436572)
succeeded for head `dc3ee7a34c83e7848ae912a604520176665f1a16`.
The completed run is `SUCCESS`; both `verify` and `postgres-17-acceptance`
passed.
This closes the JSC-0219B provider/real-PostgreSQL acceptance item only.

The ordinary deterministic suite does not claim real-PostgreSQL coverage. Its
PostgreSQL acceptance test is registered as skipped unless the dedicated runner
sets the private activation marker.

Run the harness only against a disposable local database named
`jessica_acceptance`:

```text
JESSICA_POSTGRES_ACCEPTANCE_URL=postgresql://USER:PASSWORD@127.0.0.1:5432/jessica_acceptance
npm run test:postgres:acceptance
```

The runner rejects non-local hosts, any other database name, and every URL query
or fragment before the test can mutate state. This prevents connection-library
query options such as `host`, `port`, or `sslmode` from overriding the audited
URL authority. The test then rejects a non-empty database/role namespace:
system schemas and an empty `public` schema are allowed, but any user schema or
any class, procedure, or type in `public` fails preflight. It requires
PostgreSQL `server_version_num` 17.x, applies the exact committed migration
chain, and seeds a cryptographically valid synthetic committed-review fixture
through the existing writer transaction port.

The pools retain node-postgres's default OID 20 (`int8`) text behavior. The
acceptance job therefore proves that the selected adapter's strict canonical
decimal parser handles the real driver shape without a hidden global or
pool-local parser override.

The writer and reader each give the provider exclusive ownership of a dedicated
pool. The provider claims a pool only once, rejects pre-existing or later
`release`/`remove` listeners, uses normal release only after confirmed clean
cleanup, and treats destructive discard as complete only after its exact-client
`remove` acknowledgement. Pool construction, shutdown, TLS, credentials, and
application-role membership remain production-host responsibilities.

The `postgres-17-acceptance` GitHub Actions job supplies the official
`postgres:17.11-bookworm` service pinned to OCI index digest
`sha256:84560e3b9c6874893fc4e2854f5dc3e7c1a37bc9d1dfd7a8c641310ae22ba5ad`,
verified directly from `registry-1.docker.io` on 2026-08-22. The job has a
10-minute bound, every pool connection attempt has a 5-second bound, and the
service has a `pg_isready` health check. Runtime assertions prove:

- distinct backend PIDs and an exclusive physical reader lease;
- authority, candidate, then GenerationJob session-lock acquisition, including
  a real blocked candidate-lock observation before the job lock exists;
- authority revocation and GenerationJob head-advance mutation statements
  blocking on the matching trigger advisory locks until the reader commits;
- candidate retirement blocking on the candidate status trigger before the
  committed reader releases its lock;
- rollback of those isolated race mutations without illegal reactivation,
  unretirement, or deletion of append-only evidence, followed by one final
  committed head append that makes every later committed-review read fail;
- an exact callback error surviving a confirmed rollback without destroying the
  reusable session;
- a real PostgreSQL statement timeout (`57014`) followed by confirmed rollback
  and a successful new checkout on the still-safe physical client;
- a signed review whose effective horizon is derived from `clock_timestamp()`,
  accepted strictly before that horizon and denied once the database clock
  reaches it;
- forced backend loss removing the physical pool client, followed by successful
  reconstruction on a different fresh backend PID.

`pg_stat_activity` and `pg_locks` are the acceptance oracles. A short timeout is
only a bounded polling budget, never evidence that blocking occurred. This
harness rebuilds and re-signs a synthetic plan relative to the database clock,
then independently revalidates every row/signature/binding/plan digest before
seeding. The short review-expiry window is bounded to this disposable CI fixture;
the test polls the database clock rather than treating a local timer or elapsed
sleep as authority. This harness adds no production credential, remote Supabase
mutation, QA-preview runtime authority, publication authority, or physical/J1-M
evidence. It also
does not configure a production pool/TLS/application role or implement the
authenticated non-client-mintable one-shot transport and browser runtime bridge.
