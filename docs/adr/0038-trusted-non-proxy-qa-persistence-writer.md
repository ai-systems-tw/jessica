# ADR-0038: Trusted non-Proxy QA persistence writer

## Status

Accepted for JSC-0218A.

## Context

ADR-0037 defines a pure raw-request evaluator and v2 persistence projections,
but deliberately leaves database mutation to a future trusted adapter. A
serialized projection cannot be write authority: it may contain a valid
self-signed key and internally consistent attacker-chosen facts. The v2 database
also cannot independently establish the candidate's complete GenerationJob
output from trusted ledger state or disambiguate same-specimen MeasurementSet
identity. Persistence must remain atomic under collisions, drift, cancellation,
concurrency, transaction retry, driver tampering, and a lost commit acknowledgement.

Forced RLS applies across every relation used by the writer and transition
triggers. The writer therefore needs explicit role-scoped policies in addition
to object grants. A SECURITY DEFINER RPC would introduce another privileged
callable boundary and is unnecessary for a direct server adapter.

## Decision

Add a server-only application writer and real PostgreSQL-compatible adapter. The
writer's public API accepts only opaque authenticated actor/request identity and
the complete original raw JSC-0215 request. Host trust, JWKs, clock/policy,
retry budget, and typed transactional database port are private constructor
dependencies. It accepts no persistence plan, caller control snapshot, trust,
clock, SQL, or authoritative receipt. `inspectNonProxyQaPersistencePlanIntegrity`
remains diagnostic and non-authoritative.

The writer snapshots raw hostile input synchronously before its first await with
the existing strict descriptor and resource budgets. Authentication completes,
then the host trust context is synchronously snapshotted/frozen immediately when
returned. Each attempt checks out one exclusive physical pinned session and
acquires bounded session advisory locks for job/head, authority/key, and
candidate identity in canonical order before `BEGIN` or any snapshot-producing
statement. Each bounded lock-timeout/serialization/deadlock attempt opens one
SERIALIZABLE transaction, obtains one `transaction_timestamp()` for
`observedAt`/`evaluatedAt`, and derives the authoritative snapshot from database
reads. It independently reconstructs canonical GenerationJob output and current
head from trusted ledger support, resolves sources uniquely by exact
tenant/model/variant/hash, resolves a verified same-specimen MeasurementSet
unambiguously, and reads the complete current authority/review/asset/source/
binding collision state. Every driver result is strict-parsed as hostile
`unknown`.

The read order after those locks is complete ordered ledger/current head, exact
authority row, immutable MeasurementSet and sorted sources, then deterministic
terminal heads. Generation-event and authority mutation triggers take their job
or authority key. Review insert, internal AssetVersion insert, binding insert,
source insert, and review-to-approved validators take the applicable canonical
authority -> candidate -> job transaction-advisory subset before authoritative
reads. Locator reads obtain only immutable IDs and the validators reread the
authoritative rows after locking. Candidate terminal
identity is globally unique across GenerationJobs at `(tenantId,
candidateAssetVersionId, candidateVersion)`. The writer re-runs
`evaluateNonProxyQaPersistencePlan` inside the transaction against private host
trust and consumes only the resulting in-memory projections. Reviewer-authority
registration remains an external trust-administration operation; the writer
requires and rereads a pre-existing exact active authority and has no authority
INSERT privilege. Reject inserts only the terminal review fact. Approve inserts
the terminal review, an internal-only AssetVersion initially in `review`, sorted source rows,
and the binding, then performs the approved transition. Values use parameterized
statements through the typed port and never become SQL identifiers or text.

`ON CONFLICT DO NOTHING` is not proof of idempotency. Existing or newly written
state is fully reread and reconstructed field by field; stored `row_sha256` alone
is insufficient. The shared signed-payload helper reconstructs the payload and
the signature is reverified. Immediately before commit, `clock_timestamp()`
rechecks the current head, active reviewer authority, and effective expiry so a
slow transaction cannot cross its validity horizon. Partial state, different
bytes at the same identity, relabeling, ambiguity, drift, invalid evidence,
readback mismatch, or any fault rolls back and grants nothing.

Session locks are released in reverse order on every success, denial,
cancellation, timeout, error, and ambiguous-commit path. Any advisory-lock query
rejection has unknown acquisition outcome: known acknowledged locks are reverse-
unlocked and the physical connection is permanently discarded, even when the
error is retryable. Unlock/reset failure and unknown BEGIN/COMMIT/ROLLBACK outcome
also discard. `discard()` resolves only after a real close/destroy attempt and a
pool must never repool the lease, even if close rejects. A pinned transaction
provider must roll back a rejected callback before returning that rejection.
Rejection presence is tracked independently from its JavaScript reason value;
`Promise.reject(undefined)` is still a failure and can never become a successful
return, skip cleanup, or make a discarded lease reusable.
Once the transaction callback completes, every non-serialization/deadlock/lock-
timeout rejection—including host/port/check-in errors—is unknown commit outcome
and enters independent exact recovery through a fresh lease. Retries reuse only the initial immutable raw snapshot and otherwise take fresh
database state, time, and evaluator output. Cancellation before or during the
transaction rolls back; cancellation after confirmed commit cannot undo it. A
lost commit acknowledgement is neither success nor rollback. Independent exact
verification may return `recovered-exact-commit`; partial, different, or
unreadable state returns the closed `COMMIT_OUTCOME_UNPROVEN` result.
Mutation and read-only exact recovery share the same tracked transaction-boundary
helper. Recovery therefore also destroys the lease on unknown `BEGIN`, a
successful callback followed by a lost `COMMIT` acknowledgement, a callback
error replaced by a distinct rollback/provider error, or post-callback check-in
failure. Only the callback's exact error returned after confirmed rollback may
leave that physical lease reusable.

Every query result is treated as hostile and detached/frozen in its first result
continuation under a transaction-wide aggregate budget. The adapter fixes a
catalog-only transaction search path and bounded lock, statement, and idle
timeouts. Its last awaited precommit operation is a fresh database
`clock_timestamp()` head/authority/expiry check, after receipt hashing and fault
hooks; crossing the validity horizon cannot commit.

The deeply frozen bounded receipt contains only IDs, digests, decision,
committed time, and `inserted | exact-retry | recovered-exact-commit`
disposition. The committed time is the canonical persisted transaction timestamp,
so exact retries and recovered acknowledgements reproduce it deterministically;
it is not a claim about network acknowledgement time. Public errors contain only
closed redacted codes. Neither receipt
nor error exposes SQL, SQLSTATE, constraints, table/path names, keys/JWKs, raw
signed payload, private evidence, stack, cause, or sensitive diagnostics. Every
QA-preview/runtime/publication/deployment/catalog/public and G1-G7 authority is
literally false, and JSC-0219 must not accept the receipt as authority.

The generated forward-only v3 migration adds only the trusted ledger-output and
same-specimen identity support required to derive those facts and creates one
cluster-global group role named `jessica_non_proxy_qa_writer`. Migration fails
closed if that name already exists and never alters it. The role is exactly
`NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS`,
has null password and zero memberships in either direction, owns nothing, and is
never given a credential in the repository.

The migration also constrains committed GenerationJob `max_attempts` to 1..64;
the adapter bounds complete ordered-ledger replay from that trusted policy value.
Terminal review rows persist the writer transaction timestamp and canonical text
needed for deterministic exact-retry and commit-recovery receipts.
The stored sorted source set and every method/generator/config/measurement/
attempt/creation/identity field must equal the fully replayed genesis request.

Its privileges are limited to private-schema usage; SELECT on the exact
generation/job-event/measurement/source/authority/review/asset/source/binding
relations needed by the adapter; INSERT only on the exact review/asset/source/
binding relations; and `UPDATE(status)` on `asset_versions`. It receives
no DELETE, TRUNCATE, REFERENCES, TRIGGER, CREATE, sequence, routine EXECUTE,
ownership, API-schema, default/future, or broader column grants. PUBLIC, anon,
authenticated, and service_role receive no new JSC-0218A mutation grant. Forced RLS stays enabled and
explicit `TO jessica_non_proxy_qa_writer` policies cover exactly nine SELECT
relations, four INSERT relations with `WITH CHECK`, and `asset_versions` UPDATE
with `USING` and `WITH CHECK`. The private-schema policy count becomes 33;
the pre-existing 19 authenticated member-read policies and authenticated
`private.is_tenant_member(text)` EXECUTE remain unchanged. No view, RPC,
SECURITY DEFINER routine, password, service key, or Data API mutation surface is introduced.
Role-aware invoker guards narrow those object grants to terminal reviews,
matching internal-review assets/sources/bindings, and the same asset's
review-to-approved transition. They reject ordinary drafts and unrelated retire
or status changes. The terminal-review validator locks and rejects cross-job
collisions for every INSERT path, including owner/admin paths. PUBLIC, API roles,
service_role, and the writer have no effective EXECUTE on the new or replaced
writer-path helpers; authenticated retains only the pre-existing member-read helper.

This credentialless role is part of the trusted-server TCB, not a database-side
cryptographic verifier. The relational policy/guard surface does not reverify
ES256, so compromise of a future production LOGIN or parent membership could
submit all-zero signature bytes or attacker-selected digests that the normal
application writer rejects during raw evaluation and full readback. Provisioning
a dedicated LOGIN and membership is an external production operation, outside
the repository and this ticket; no secret, SECURITY DEFINER, or RPC is added to
mask this residual.

## Consequences

JSC-0218A provides executable, atomic private persistence and deterministic
idempotency without turning client material or cached plans into authority. Its
real local integration path verifies migration upgrade, rollback, concurrency,
readback, commit ambiguity, catalog attributes/grants/denials, and policy/RLS
exactness. The catalog proof snapshots every rewritten validator's exact length-prefixed
advisory operands/seed and each relevant enabled `BEFORE ... FOR EACH ROW`
validator/guard trigger definition and invoked function. PGlite exercises
executable transaction and role behavior but does not prove real PostgreSQL
pooled-session/SERIALIZABLE wait semantics. Production
acceptance requires a real PostgreSQL two-session test of canonical blocking and
collision behavior, callback-rejection rollback, destructive discard, and fresh-
connection recovery after lost lock/commit acknowledgements with the selected
pool driver. Environments that cannot faithfully emulate PostgreSQL role behavior
must retain static/catalog verification and document that residual rather than
weaken the boundary.

The implementation performs no remote Supabase operation and provisions no
production connection or credential. It commits no A3893 private bytes, real
J1-M evidence, or temple marking, creates no real control-plane row, connects no
runtime loader, and grants no QA-preview, AssetVersion publication, deployment,
catalog/public, live, G1/G2, or other G1-G7 authority. The required sequence is
JSC-0218, then JSC-0218A, then JSC-0219.
