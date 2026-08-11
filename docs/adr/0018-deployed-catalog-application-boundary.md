# ADR-0018: Deployed Catalog Application Boundary

## Status

Accepted for the local E2 implementation slice. This ADR does not record production,
browser-network, commerce, physical-asset, or deployment evidence.

## Context

The runtime already has a generic catalog/manifest/GLB integrity loader for non-live
modes and the only `public-live` path through a verified signed active Deployment.
E2 needs exact commerce SKU lookup, explicit variant fallback, unavailable
observability, and first-asset prefetch without turning catalog metadata into
publication authority or fetching verified bytes a second time.

## Decision

`CatalogLookupRequest` is strict schema v1 unknown input. It binds bounded request,
tenant, site, production environment, requested SKU, frame model, frame variant, and
either `none` or an exact `explicit-same-model` fallback target. Unknown fields,
accessors, symbols, custom prototypes, unsafe identifiers, and same-SKU/same-variant
fallback are rejected before network access.

Catalog, manifest, signed-envelope, and verified Deployment document records use the
same plain-data rule recursively: only Object/null prototypes, no symbols, and only
enumerable data descriptors are accepted. Strict arrays reject custom prototypes,
holes, accessors, symbols, and extra properties. Validation inspects descriptors
before dereferencing, so hostile getters are never executed.

`evaluateCatalogSelection` is pure. Exact lookup succeeds only when catalog
SKU/model/variant match the request and the complete entry matches the verified
Deployment tenant/SKU/model/variant/asset ID/version/manifest hash. Fallback is
considered only when the requested SKU is absent. Its model must equal the requested
model, its exact SKU/model/variant must exist, and it must be the exact signed active
Deployment target. An existing but inactive requested SKU does not silently fall
back. Cross-model, cross-tenant, cross-asset, and non-active substitution fail closed.

The adapter always calls `loadDeployedRuntimeAsset`; it has no generic or plain-object
`public-live` route. Signed Deployment verification still precedes selection.
`published` and `recommendedForLive` remain additional admission conditions and
never establish authority. Catalog, manifest, and GLB actual bytes remain bound by
the signed catalog hash, catalog manifest hash, manifest model hash/length, and
shared GLB validator.

`CatalogUnavailableEvent` has the exact type `catalog.asset-unavailable` and closed
reason codes `REQUESTED_SKU_NOT_FOUND`, `REQUEST_IDENTITY_MISMATCH`,
`REQUESTED_SKU_NOT_ACTIVE`, `FALLBACK_SKU_NOT_FOUND`, `FALLBACK_MODEL_MISMATCH`,
`FALLBACK_TARGET_NOT_ACTIVE`, `DEPLOYMENT_REJECTED`, `ASSET_CHAIN_REJECTED`,
`PREFETCH_CANCELLED`, `PREFETCH_LIMIT_REACHED`, and `REQUEST_CANCELLED`.

The event contains only time, bounded request/tenant/site/SKU/model/variant IDs,
environment, fallback kind, and reason code. It has no extension/detail field and
never serializes exceptions, URLs, paths, stacks, raw errors, credentials, secrets,
camera/face/image/video data, landmarks, transforms, pose, or scale. Invalid unknown
requests are not logged. Sink absence, synchronous throws, and asynchronous rejection
are non-fatal to the primary fail-closed result.

First-asset prefetch holds at most one keyed request. Same-key concurrent prefetch
and consumption share one promise and the same verified `ArrayBuffer`; consumption
does not refetch. A different speculative key is rejected; a real load cancels and
settles stale speculation before starting. Cancellation propagates through deployment,
catalog, manifest, and GLB fetch signals. Fetches use credentials omit, no-store,
no-referrer, explicit redirect following, and final-origin revalidation. Catalog,
manifest, and GLB responses are bounded to 1 MiB, 256 KiB, and 32 MiB; signed hashes
and declared GLB length are still verified over actual bytes.

Host deployment-origin configuration is non-empty and every entry must be exactly a
canonical HTTPS origin; paths, trailing slash, HTTP, credentials, and invalid values
fail before fetch. Deployment, catalog, manifest, and model URLs—including final
redirect URLs—must have empty username/password even when their origin otherwise
matches. Once a Response exists, non-ok status, redirect/origin/credential rejection,
and invalid/oversized declared length best-effort cancel the unread body before the
stable error is returned.

Cache identity deliberately excludes `requestId`: it includes only tenant/site/
environment/SKU/model/variant/fallback selection semantics. This lets a later
commerce request reuse the same immutable verification without a second fetch.
Unavailable results are re-emitted with the consuming request's own ID so correlation
remains honest. Consumer cancellation races only that consumer's wait and returns
`REQUEST_CANCELLED`; it never aborts a shared prefetch. Explicit prefetch cancellation
continues to return `PREFETCH_CANCELLED`. Every handle returned by `prefetchFirst`,
including a same-key secondary handle, is an owner of that single shared speculative
operation: calling any such handle's `cancel()` aborts the shared prefetch for all
prefetch owners. In contrast, `load(value, signal)` is a non-owning consumer whose
signal cancels only its own wait.

Verification derives `freshnessDeadlineEpochMs = min(expiresAt,
issuedAt + maximumDocumentAgeMs)`. A cached success is returned only while
`nowEpochMs < freshnessDeadlineEpochMs`; at the exact deadline or later it is
discarded and the full signed Deployment plus immutable asset chain is refetched and
reverified against the unchanged monotonic receipt rules. The 256 KiB signed envelope
is streamed with the same pre-allocation bound as assets, including chunked responses;
invalid declared lengths and actual overrun cancel and release the response body.

## Consequences

The boundary is reusable by a future hosted-widget/commerce adapter without adding
a second live authority path. A fallback target must already be the immutable signed
active target. Supporting multiple independently active SKUs would require a new
signed Deployment model, not relaxation here.

Current evidence is deterministic ports and Node tests. It does not prove real
browser cancellation timing, CDN redirect/header behavior, production telemetry,
live commerce integration, or network performance. G1/G2/G3 and physical gates
remain unchanged.
