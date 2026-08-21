# ADR-0037: Non-Proxy QA control-plane persistence

## Status

Accepted for JSC-0218.

## Context

JSC-0215 produces a strict signed terminal human decision, but the v1 control
plane allowed standard/premium status-only approval and did not bind that
decision, its reviewer authority, exact source identities, MeasurementSet,
variant, GenerationJob output, provenance composition, validity, or rights to an
AssetVersion. A legacy `qa_review_decisions` row is not JSC-0215 authority.

## Decision

Add `evaluateNonProxyQaPersistencePlan`, a pure constructor that accepts the
complete raw JSC-0215 request plus a host-owned control-plane snapshot. It
synchronously snapshots hostile input before its first await and re-runs
JSC-0215 against host trust, clock, lineage, reviewer policy, exact source-hash
mapping, verified MeasurementSet mapping, unused candidate identity, and
existing-row collision heads. It never accepts a cached or serialized JSC-0215
result.

The output is a deeply frozen canonical row projection, not SQL or a mutation
command. Every authority/admission/publication/deployment/catalog/runtime and
G1-G7 claim is literally false. Reject projects only the complete signed
terminal record. Approve additionally projects one exact internal-review-only
AssetVersion, binding, and source rows; the review record retains the complete
approved asset projection and its digest. Stable row identities exclude host
`evaluatedAt`; same identity with different bytes is a collision denial.

`inspectNonProxyQaPersistencePlanIntegrity` performs strict semantic and
integrity inspection, including the signature under the JWK embedded in the
plan. It grants no persistence or write authority: an attacker can create a new
key and self-sign. The only trusted constructor is the raw evaluator above.
A future writer adapter must accept and re-evaluate the original raw request and
host context, then consume the resulting in-memory projections. It must never
authorize a serialized plan through the integrity inspector alone.

The forward-only v2 migration adds private append-only reviewer-authority,
terminal-review, and approve-binding relations, exact AssetVersion/source
projection identities, verified MeasurementSet and current GenerationJob-head
checks, active-authority locks/rechecks, and global standard/premium approval
hardening. It has a data-free precondition rejecting unexpected pre-v2
standard/premium approved/published rows. JSC-0218 internal-review assets cannot
become recommended-live or published. The new private tables use forced RLS,
no policies, and no browser/service mutation grants or Data API view/RPC.

SQL is not an ES256 verifier and does not establish host trust, JWK fingerprint,
canonical payload/row/source-set/asset digests, or reviewer-policy truth. The
record persists bounded `maximumReviewAgeMs`, the asserted policy digest, and the
exactly derived review-fresh/effective horizons; SQL enforces their relational
equality, immutability, uniqueness, locking, and transition
invariants after a trusted adapter supplies projections. Trigger functions are
security invoker with empty `search_path`; no new definer routine is required,
and execute is revoked from PUBLIC, anon, authenticated, and service_role.

An `approved` row is immutable historical decision evidence, not a currently
admissible capability. JSC-0219 remains the separate authenticated, time-bounded
committed-review QA-preview boundary and must recheck the exact binding, active
reviewer authority, and `effective_valid_until` at issuance and use. Publication
and release authority remain future, distinct boundaries.

## Consequences

The insecure v1 status-only standard/premium approval route is superseded, while
no replacement public publication path is opened. No runtime loader is connected.
No remote Supabase operation, real row, service key, private key, A3893 media,
physical evidence, deployment, publication, or gate pass is created or claimed.
