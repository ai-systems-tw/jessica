# ADR-0039: Committed-review QA-preview capability core

## Status

Accepted for the JSC-0219 process-local core and pinned PGlite/PostgreSQL reader
reference adapter. JSC-0219B selects `node-postgres` `pg.Pool` as the concrete
Node.js pooled-session boundary and PostgreSQL 17 on a Linux GitHub Actions
service container as the real two-session acceptance environment. Selection is
normative; acceptance remains open until the provider implementation and the
required CI race suite pass. Production transport remains open.

## Context

An `approved` AssetVersion and a JSC-0218A receipt are historical evidence, not
runtime authority. A preview request can become stale after reviewer revocation,
session expiry, GenerationJob head advance, MeasurementSet/source/variant drift,
or review expiry. The former generic `loadVerifiedRuntimeAsset(...,
mode: "qa-preview")` path could not distinguish those cases before network or
renderer initialization.

## Decision

Add a trusted-host service whose only caller inputs are opaque authentication,
an exact tenant/AssetVersion locator, and later the exact process-local
capability object. It accepts no JSC-0218A receipt, serialized plan, caller clock,
control snapshot, URL, origin, SKU, or digest. Authentication is strict tenant,
actor, reviewer, session, session-expiry, and exact `qa-preview:read` scope, and
is repeated on use with the same session.

Issuance and use each run under a typed read-only database port. The reference
adapter pins one physical lease, activates the dedicated credentialless preview-
reader role, takes canonical authority -> candidate -> GenerationJob session
advisory locks, and runs one `REPEATABLE READ READ ONLY` transaction. It repeats
the non-authoritative locator after locking and returns only reconstructed state. Hostile
rows are exact-parsed and frozen. Both passes require the exact approve review,
binding and row digests, active authority, current output/head, variant,
verified same-specimen MeasurementSet, sorted sources, internal-review-only
rights, and database clock strictly before the effective horizon. A final full
reread followed by `clock_timestamp()` is the last authoritative/domain read
inside the transaction; COMMIT, unlock, and session reset necessarily follow.
Attachment matrices and approved envelopes are strict-parsed raw persisted
JSC-0218 projections. The adapter reconstructs the complete canonical persistence
plan and runs the shared row-ID/digest, signed-payload, ES256, source-binding and
cross-row integrity verifier; it never invents matrix/envelope digest columns.
The v4 status trigger makes every committed non-Proxy AssetVersion status change,
including `approved` -> `retired`, take the identical candidate transaction lock,
so it conflicts with a reader-held session lock instead of escaping the final
repeatable-read snapshot.
Capability expiry is the minimum of the host TTL (at most 15 minutes),
authenticated session expiry, and review effective expiry.

The selected production provider obtains one `pg.PoolClient` with
`pool.connect()` and keeps that exact client from locator lookup through session
lock acquisition, transaction, final database clock, COMMIT/ROLLBACK, unlock,
and reset. It never uses `pool.query()` for a transaction or a session-lock
sequence. A clean lease may call normal `release()` only after confirmed cleanup;
an unknown query/transaction/unlock/reset/check-in boundary must destroy the
client instead of returning it to the pool. Pool size, checkout timeout,
statement/lock/idle timeouts, TLS, credentials, and application-role membership
remain bounded host configuration rather than caller input.

The real-database acceptance target is a PostgreSQL 17 service on a Linux GitHub
Actions runner. The suite must assert the server major version, apply v1 through
v4 from an empty database, use two independently checked-out clients with
different backend PIDs, and observe actual blocking rather than simulated call
order. It covers canonical authority -> candidate -> job ordering, reviewer
revocation, GenerationJob head advance, approved -> retired status mutation,
exact expiry, rollback/timeout cleanup, destructive discard, and a fresh-client
recovery path. A mutation blocked behind a reader must become visible after the
reader releases its locks, and the next issue/use must deny the stale chain.
PGlite remains the fast deterministic schema/shape suite; it is not a substitute
for this job.

Capabilities are process-local WeakMap identities stored inside one service
instance. A capability is burned synchronously before the first use await, so
concurrent or failed use cannot replay it, and another service instance cannot
consume it. Successful use returns only deeply frozen diagnostic eligibility:
its authority explicitly sets runtime and QA-preview runtime false. It is not a
permit, token, browser proof, or serializable authority.

The generic loader rejects `qa-preview` before all fetches. The browser
application import graph references no committed-review module, mint factory,
WeakMap consumer, dedicated loader, or QA-preview proof. The generic static build
currently copies package artifacts, but those unreferenced files are
non-authoritative and no browser runtime path consumes them. This is intentional:
putting both minting and verification in one browser entry graph would let the
browser construct fake auth/DB dependencies, while a server WeakMap object cannot
cross HTTP/process boundaries.

## Consequences

The repository now has an executable fail-closed server-side issuance/use
scaffold, a typed database contract, a concrete pinned PGlite/PostgreSQL reader,
a dedicated forced-RLS SELECT-only role, and a closed generic browser path.
The selected `pg.Pool` provider and PostgreSQL 17 two-session CI job are required
acceptance evidence, not evidence merely because they are named here. PGlite
verifies catalog/grant shape and transaction behavior but does not prove real
PostgreSQL pool pinning or two-session blocking/race behavior. Because WeakMap identities cannot cross an
HTTP or process boundary, it also does not yet provide a deployable browser
transport or runtime integration. Production completion requires a separately
authenticated signed/online one-shot transport whose verifier is not client-
mintable, plus a successful required PostgreSQL 17 lock/revocation/head-advance/
retirement/expiry job. A co-located host bridge is acceptable only if the untrusted browser
cannot construct its trusted dependencies or invoke the private loader directly.

No Supabase project was changed, no credential was added, and no real private
asset/evidence row exists. This ADR makes no QA-preview availability, public
runtime, deployment, publication, physical G1/G2, or other gate PASS claim.

## References

- [node-postgres transactions](https://node-postgres.com/features/transactions):
  every statement in a transaction must use the same checked-out client; a
  transaction must not use `pool.query()`.
- [node-postgres pooling](https://node-postgres.com/features/pooling): checked-out
  clients must be returned or destroyed deliberately, and one pool should remain
  bounded.
- [GitHub Actions PostgreSQL service containers](https://docs.github.com/en/actions/tutorials/use-containerized-services/create-postgresql-service-containers):
  service containers require a Linux runner and support PostgreSQL health checks.
- [Supabase PostgreSQL 17 change](https://supabase.com/changelog/46080-self-hosted-supabase-upgrading-from-pg-15-to-17-breaking-change):
  PostgreSQL 17 is the current Supabase platform/default self-hosted target; an
  existing PostgreSQL 15 data directory does not auto-upgrade. Jessica's CI uses
  a fresh disposable database and performs no remote upgrade.
