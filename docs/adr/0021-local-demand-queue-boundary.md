# ADR-0021: Local privacy-safe demand queue boundary

Status: Accepted for local preparation only

## Context

Wave F1 needs a transparent way to order unavailable try-on demand using request count, sales rank,
continuous stock, and frame-shape coverage. None of the authoritative sales, inventory, catalog-
coverage, production queue, or operations systems exists in this repository. Accepting arbitrary
analytics, raw catalog errors, or caller-authored scores would invent authority and create privacy,
relabel, replay, and cross-tenant risks.

## Decision

Schema v1 accepts only exact bounded unavailable evidence and metric snapshots. Every record binds
tenant/site/production. A target is either exact SKU + FrameModel + FrameVariant + closed shape, or
an explicit unresolved candidate ID + closed shape. Scope-wide SKU, variant, and candidate binding
prevents a later record or command item from relabelling identity. Contracts exclude user/session/
device identities, raw errors, URLs, capture references, images, landmarks, pose, biometrics, media,
and arbitrary properties.

Explicit adapters accept only demand-qualifying E2 `CatalogUnavailableEvent` reasons or recoverable
E3 `CATALOG_UNAVAILABLE`/`ASSET_UNAVAILABLE` occurrences. E2 and E3 use the original request ID as a
shared correlation identity, so observing the same attempt through both paths counts once. Reuse of
that correlation for a different target fails closed.

The pure policy uses an inclusive 30-day demand window. Sales rank is fresh for 24 hours, inventory
for one hour, and shape coverage for seven days, including each exact boundary. Future samples,
relabelled snapshot IDs, and conflicting same-time samples reject the build. Metric parsing,
queue eligibility, and operational readiness are separate: only fresh `continuous + in-stock`
inventory is eligible. Missing/stale/unknown/discontinuous/out-of-stock inventory excludes with a
closed reason. Missing/stale rank or coverage grants no points and never invents data.

Priority is `demandCount × 1000 + rank bonus 0..100 + underrepresented-shape bonus 25`. The multiplier
is greater than all bonuses combined, so one additional demand always dominates. Counts are not
capped inside the 1,000-evidence build budget. Ties use first demand time then canonical target.
Builds accept at most 1,000 evidence and 1,000 samples of each metric, output at most 500 queue items,
and serialize to at most 512 KiB. Capacity exclusion is separate from eligibility.

The durable command parser snapshots and deeply normalizes every target/item/reason before its first
asynchronous digest operation. It checks window membership, sequential positions, exact score/reason
consistency, sort order, unique/relabel-safe targets, and aggregate demand budget. Canonical SHA-256
and `dqv1_` idempotency identify the operational output. Different raw evidence that produces the
same queue intentionally coalesces; this digest is not source-evidence provenance. A production
ingestion system must retain authenticated authoritative inputs separately.

Optional local orchestration uses injected time/read/write ports. Read values and writer responses
are hostile boundaries. Only exact `{status:"accepted"}` or `{status:"idempotent"}` acknowledges a
write; rejection, exception, accessor, symbol, custom prototype, or unknown field returns a closed
failure. No port can promote readiness. Every command fixes `operationalStatus=local-preparation-only`
and `g5Ready=false`.

## Consequences

- Reordered/replayed local evidence yields deterministic output without double counting.
- Missing sales or inventory is visible and never synthesized.
- No SQL, Supabase migration, remote mutation, or physical asset is required.
- Local command generation is not real demand, sales, stock, catalog, operational, human-effort,
  production-queue, or G5 evidence.
- G5 remains not active until authoritative integrations and representative operational evidence
  satisfy the roadmap exit conditions.
