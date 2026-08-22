# JSC-0220 PostgreSQL 17 acceptance harness

The ordinary deterministic suite does not claim real-PostgreSQL coverage. Its
PostgreSQL acceptance test is registered as skipped unless the dedicated runner
sets the private activation marker.

Run the harness only against a disposable local database named
`jessica_acceptance`:

```text
JESSICA_POSTGRES_ACCEPTANCE_URL=postgresql://USER:PASSWORD@127.0.0.1:5432/jessica_acceptance
npm run test:postgres:acceptance
```

The runner rejects non-local hosts and any other database name before the test
can mutate state. The test then rejects a non-empty database/role namespace,
requires PostgreSQL `server_version_num` 17.x, applies the exact committed
migration chain, and seeds a cryptographically valid synthetic committed-review
fixture through the existing writer transaction port.

The pools retain node-postgres's default OID 20 (`int8`) text behavior. The
acceptance job therefore proves that the production adapter's strict canonical
decimal parser handles the real driver shape without a hidden global or
pool-local parser override.

The `postgres-17-acceptance` GitHub Actions job supplies an official pinned
`postgres:17.11-bookworm` service with a `pg_isready` health check. Runtime
assertions prove:

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
- forced backend loss removing the physical pool client, followed by successful
  reconstruction on a different fresh backend PID.

`pg_stat_activity` and `pg_locks` are the acceptance oracles. A short timeout is
only a bounded polling budget, never evidence that blocking occurred. This
harness rebuilds and re-signs a synthetic plan relative to the database clock,
then independently revalidates every row/signature/binding/plan digest before
seeding. It does not claim the exact expiry boundary; that remains covered by
the pure-core boundary tests rather than a wall-clock wait in CI. This
harness adds no production credential, remote Supabase mutation, QA-preview
runtime authority, publication authority, or physical/J1-M evidence.
