# ADR-0022: Local fail-closed batch capture boundary

Status: Accepted for local preparation only

## Context

Wave F2 needs repeatable SKU binding, operator classification, private raw capture references, and a
quality decision before the operator advances. The repository has no authorized scanner, camera station,
private raw store, operator identity provider, or production operation. Raw bytes in a general contract,
fixture, public catalog, Widget, commerce event, or analytics event would cross existing privacy and
authority boundaries. F1 demand priority and E2 deployed catalog identity must not become capture authority.

## Decision

Schema v1 is an exact append-only event log replayed by a pure reducer. Every event binds tenant, site,
production environment, operator session, batch, monotonic sequence, and millisecond UTC time. Items bind
SKU, FrameModel, FrameVariant, a closed product type, and a closed primary/color-variant classification.
SKU and item IDs are unique in one batch. A FrameModel may own multiple variants as defined by the catalog;
one FrameVariant cannot be rebound to a different SKU/model tuple. Product type is fixed within a model and
at most one variant tuple per model may be `model-primary`. F1 may order the same identity but never
authorizes capture or contributes another count at this boundary.

Raw bytes are not a contract field. A capture event stores only a bounded opaque `localraw:` reference and
closed identifiers. Paths, URLs, data URLs, bytes, media metadata, raw errors, and arbitrary properties are
rejected. The outer `packages/batch-capture` application issues an object-identity capability held in a
module-private WeakMap. Its grant exactly binds tenant/site/operator-session/batch/item/capability/reference
and expiry. Expiry uses the same 2020-01-01 through 2100-01-01 inclusive range as event timestamps. Plain
structural objects cannot forge it. Exact expiry is inclusive. A failed mismatch or final replay/global-
identity/budget rejection does not consume the grant; only a fully validated append consumes it. Exact retry
of an already-appended identical event is
idempotent even after consumption, but a different/new event cannot reuse the capability. Capture ID,
capability ID, and local reference are unique and anti-relabel across the entire batch.

Every latest capture needs one closed quality decision. `retake` clears advance authority and requires a
new capture. Only `accept` or `reject` permits item advance, and completed state retains that exact outcome.
Batch completion requires all expected items to advance and fixes `operationalStatus` to
`local-preparation-only` and `g5Ready` to false. Replayed input is deeply normalized and frozen before it is
returned. Unknown fields, custom prototypes, accessors, symbols, cycles, sparse arrays, byte/event/item
oversize, duplicate/relabelled IDs, reordered time/sequence, stale decisions, and post-completion events fail
closed. Limits are 100 items, 1,000 events, 1 MiB canonical event log, and 16 issue codes per decision.

## Consequences

- Deterministic replay distinguishes successful and rejected items and cannot interpret completion as QA.
- Private reference authorization is explicit without putting raw data or filesystem authority in core code.
- A later scanner/camera/store adapter must authenticate operator authority and own raw lifecycle/TOCTOU
  controls; this ADR does not claim those external guarantees.
- No remote write, public upload, SQL migration, camera/device use, physical product, rights, actual-wear,
  operational evidence, or gate passage is created. G5 stays not active.
