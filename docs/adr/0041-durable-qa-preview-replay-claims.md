# ADR-0041: Durable QA-preview replay claims

## Status

Accepted for the JSC-0221B repository implementation and PostgreSQL 17
acceptance boundary. Production credentials, deployment, monitoring, and
capacity operations remain external.

## Context

ADR-0040 defines an authenticated one-shot QA-preview transport, but its
process-local replay store cannot survive a process restart and cannot resolve
an unknown PostgreSQL commit outcome. Returning runtime authority from an
uncommitted insert is unsafe: the transaction may later roll back, allowing a
second caller to claim the same signed grant. An `INSERT ... ON CONFLICT` result
also cannot be the final time decision because it may wait behind another
transaction and finish after the signed expiry.

Deleting expired tombstones is unsafe without a proved monotonic clock and
retention bound. A database-clock rollback could make an old signed grant appear
valid after its replay row had been removed. A general-purpose cleanup role
would also turn `DELETE` into a replay-reopening capability.

## Decision

JSC-0221B stores permanent, append-only replay tombstones in
`private.committed_review_qa_preview_replay_claims`. `grant_id` is the global
one-shot key. Each public `claim()` call creates a new internal 256-bit
`claim_attempt_id`; it is retained only through that call's bounded
ambiguous-outcome recovery and is never serialized to a browser or transport
grant. An exact attempt ID is unique across the table, preventing a recovery
token from being relabelled to a different grant.

The dedicated credentialless
`jessica_committed_review_qa_preview_replay_claimer` role is not a login, owner,
member, superuser, or RLS bypass. It receives only the exact schema, column
`INSERT`, and column `SELECT` privileges required by the adapter. Forced RLS and
row constraints enforce canonical identifiers, the canonical expiry spelling,
`claimed_at < expires_at`, and the maximum two-minute signed horizon. The role
has no update, delete, truncate, trigger, reference, sequence, routine, API,
DDL, or default/future grant. There is no runtime janitor or tombstone deletion
path.

Caller `observedAt` is validated as bounded canonical input but grants no clock
authority. PostgreSQL `clock_timestamp()` decides insertion and every successful
readback. Equality with `expires_at` is expired.

The initial CAS runs on one pinned physical session. No insert or same-
transaction read result returns `true`. After acknowledged transaction durability
and clean session completion, the adapter opens a later pinned checkout and
selects the exact row together with a fresh database clock. Only an exact
`grant_id`, `claim_attempt_id`, and canonical expiry match with
`db_now < expires_at` succeeds. A different attempt is an ordinary replay and
returns `false`; absent, duplicate, malformed, relabelled, or expired evidence
fails closed.

When an error occurs after database work could have committed, the original
lease is quarantined and physically discarded. One internal recovery attempt
uses the same attempt ID on a fresh physical session: a committed original is
observed as the same tombstone, while a rolled-back original may be inserted by
the recovery transaction. Recovery itself must commit cleanly and is followed
by another later database-clock readback before success. A second ambiguous
boundary is not retried and never returns authority.

Real PostgreSQL 17 acceptance must cover distinct-session concurrency, conflict
commit and rollback, waits crossing expiry, lost commit acknowledgement,
old-client destruction and fresh-client recovery, backend termination,
database/process restart persistence, exact expiry, hostile result shapes, and
the catalog privilege/RLS matrix. Static CI contracts prevent these cases and
the dedicated PostgreSQL service from silently disappearing.

## Consequences

The transport can use a durable one-shot decision that survives application and
database reconnects and does not confuse an uncommitted row with runtime
authority. A compromised claimer can burn unpredictable grant IDs as a denial of
service, but cannot mint a signed grant, reopen a consumed grant, read other
private control-plane data, or grant public-live/publication/commerce authority.

Permanent tombstones deliberately trade storage growth for replay safety. A
future retention design requires separate proof of monotonic time, maximum clock
rollback, signed-grant horizon, and deletion authorization; it cannot be added
as an ordinary cleanup job. Production LOGIN membership, secrets, TLS, pool
sizing, primary routing, migrations, monitoring, backup, deployment, and
operations evidence remain open. Nothing in this decision establishes physical,
same-specimen, marking, caliper, actual-wear, J1-M, or G1-G7 evidence.
