# ADR-0019: Local privacy-safe commerce event boundary

Status: Accepted

## Context

E1 defines a hostile-input WidgetProtocol and E2 defines verified catalog selection,
but neither is an analytics contract. Forwarding WidgetProtocol payloads, catalog
records, or exceptions directly to telemetry would admit camera/capture data,
arbitrary text, mutable product labels, and retry duplicates. E3 needs deterministic
local policy evidence without claiming that a production telemetry system exists.

## Decision

`CommerceEvent` schema v1 is a closed unknown-input union for open, camera permission
result, try-on start, product change, capture occurrence, cart request, close, and a
stable error classification. Every event binds tenant/site/environment/session,
single-use event/request identity, a 1..256 sequence, and an exact millisecond UTC
timestamp in the supported 2020–2100 range. Product-bearing events bind SKU,
FrameModel, FrameVariant, AssetVersion ID/version, Deployment ID, and catalog,
manifest, and model SHA-256 digests.

The schema has no extension-property map. It rejects unknown fields, raw error text,
paths/stacks, secrets, URLs, camera frames/images, landmarks, pose/scale/biometrics,
and capture bytes. Although WidgetProtocol may return a bounded session-local opaque
`captureRef` to its parent, E3 deliberately discards it. The funnel needs only the
fact that capture occurred; retaining the reference adds linkability without a
measurement requirement.

A pure reducer accepts strictly contiguous sequence, nondecreasing event time, and a
maximum four-hour session horizon. It binds the first tenant/site/environment/session
for the entire stream and retains every event/request ID for the exact 256-event
budget. It rejects replay, reorder, open twice, permission twice, start before a
granted permission, capture/cart before active try-on, implicit product substitution,
events after close, and all events after a nonrecoverable error. A nonrecoverable
error transitions directly to closed, including before open, so it creates no
unclosable intermediate state. A product may change only through the explicit
product-change event.

The batch boundary accepts 1–32 events, at most 32,768 UTF-8 bytes of the exact final
canonical envelope, while each event is at most 8,192 bytes. `byteLength` therefore
includes headers, chain/digest fields, and events. Derivation canonicalizes a projection
with fixed-length zero digest/idempotency placeholders, settles `byteLength`, hashes
that full projection with SHA-256, then writes `batchSha256` and
`idempotencyKey=ceb1_<batchSha256>`. Any header, event, product, payload, or middle-event
mutation changes the digest/key or fails parsing.

Every batch also binds `priorBatchSha256`. The first batch requires null and sequence
1; later batches require the evaluator's exact prior digest and next sequence. The
cross-batch evaluator replays every event through the lifecycle reducer before sink
dispatch. Parsing alone is structural/integrity validation and never proves lifecycle.
Dispatch requires the prior ledger state and advances it only after an accepted sink
result. It has an exact 5,000 ms timeout, AbortSignal support, closed accepted/
retryable/terminal results, and converts sink or clock exceptions into stable results.
Sink responses are hostile input: prototypes, symbols, accessors, and unknown fields
are rejected without invoking getters.

The pure cross-batch evaluator keeps a structural state API for deterministic tests,
but production dispatch does not trust that structure. Dispatch accepts only an opaque
ledger object created and advanced inside the commerce module and registered in a
private WeakMap. Plain objects—including structurally valid active states with a
correct prior digest—cannot authorize cart-before-open, cross-tenant/session replay,
or any sink call. Each opaque ledger is also a one-shot dispatch capability: a private
idle/in-flight/consumed state rejects concurrent use and rejects reuse after acceptance.
Retryable, aborted, rejected-response, and preflight failures release the same ledger
for an explicit retry with the identical batch identity.

`createParentWidgetCommerceObserver` and
`createCatalogUnavailableCommerceSink` are the only integration adapters. Both
re-parse their inputs, enforce bindings, and contain observer failure. Widget replay
therefore cannot double count, and telemetry behavior cannot change try-on, capture,
catalog, or cart behavior. Catalog failures collapse to `CATALOG_UNAVAILABLE`; their
raw reason is not copied into the commerce stream.

Production product attribution cannot come from a caller-authored product record.
The public-live loader captures a private WeakMap proof for the exact returned
`VerifiedRuntimeAsset` identity after Deployment/catalog/manifest/model verification.
The try-on-web registry derives an immutable attribution snapshot only from that proof;
structural clones, calibration/QA assets, and mismatched or unregistered values fail.
The arbitrary resolver remains explicitly named `localProductForSku` for local tests.
Each production registry is constructed with one exact bounded
tenantId/siteId/`production` scope. Registration requires the loader proof to match
all three fields, resolution requires that same scope, and production session creation
throws on any registry/session mismatch. Identical SKUs in different scoped registries
therefore remain separate and cannot be relabelled under another event envelope.

No SQL table or remote service is added. The existing Supabase control plane remains
tenant-RLS and append-only, but a local fake sink is not an analytics authority.

## Consequences

- The local boundary can be tested without a network or Supabase mutation.
- Capture counts cannot be joined back to a local capture artifact by this stream.
- Production work still needs consent/legal policy, retention and deletion policy,
  authenticated ingestion, tenant authorization, durable idempotency, abuse control,
  operational monitoring, and browser/network evidence.
- Fake/local sink output is not production telemetry, consent evidence, analytics
  evidence, commerce evidence, or a G1/G2/G3/G4 promotion.
