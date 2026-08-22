# ADR-0039: Committed-review QA-preview capability core

## Status

Accepted for the JSC-0219 process-local core. Production transport and database
adapter acceptance remain open.

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

Issuance and use each run under a typed read-only database port. A production
adapter must hold canonical authority -> candidate -> GenerationJob advisory
locks on one pinned transaction and return only authoritative state. Hostile
rows are exact-parsed and frozen. Both passes require the exact approve review,
binding and row digests, active authority, current output/head, variant,
verified same-specimen MeasurementSet, sorted sources, internal-review-only
rights, and database clock strictly before the effective horizon. A final full
reread followed by `clock_timestamp()` is the last awaited database operation.
Attachment-matrix and approved-envelope digests are the persisted canonical
JSC-0218 row fields; the scaffold never recomputes them from caller JSON or an
invented encoding.
Capability expiry is the minimum of the host TTL (at most 15 minutes),
authenticated session expiry, and review effective expiry.

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
scaffold, a typed database contract, and a closed generic browser path. It does
not yet contain the production pinned
PostgreSQL adapter for that contract. Because WeakMap identities cannot cross an
HTTP or process boundary, it also does not yet provide a deployable browser
transport or runtime integration. Production completion requires a separately
authenticated signed/online one-shot transport whose verifier is not client-
mintable, plus real PostgreSQL two-session lock/revocation/head-advance/expiry
tests. A co-located host bridge is acceptable only if the untrusted browser
cannot construct its trusted dependencies or invoke the private loader directly.

No Supabase project was changed, no credential was added, and no real private
asset/evidence row exists. This ADR makes no QA-preview availability, public
runtime, deployment, publication, physical G1/G2, or other gate PASS claim.
