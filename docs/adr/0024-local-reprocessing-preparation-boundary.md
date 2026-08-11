# ADR-0024: Local fail-closed reprocessing preparation boundary

Status: Accepted for local preparation only

## Context

Wave F4 names regeneration, previous-QA comparison, canary publication, and rollback, but this repository has no
raw-material reader, authenticated upstream provenance, generation executor for this flow, human QA authority, or
control-plane/publication authority. A digest, metric label, canary plan, or old version reference cannot create any
of those authorities. ADR-0011, ADR-0012, ADR-0016, and ADR-0023 remain controlling boundaries.

## Decision

Use strict schema-v1 request, event-ledger, local-plan, and canonical-command contracts with policy `f4-local-v1`.
The request binds tenant/site/production, SKU/model/variant, the exact prior asset/version and manifest/model hashes,
prior GenerationJob identity/input/head, review head and QA candidate digests, nonzero immutable source/capture
digest candidates, and the new generation request identity/input hashes. Every external digest is explicitly
unverified. Raw bytes, raw references, paths, URLs, media, and filesystem/network handles are not representable.

The canonical request digest excludes its derived request ID and idempotency key; those values are then derived from
the digest and independently recomputed on parse. One immutable request permits exactly one digest-only candidate
attempt. A retry needs a new request/new generation identity. This avoids pretending that unavailable raw material
can be executed or that a dead multi-attempt authority exists.

The contract-owned pure reducer verifies a maximum-five-event monotonic SHA-256 chain, strict canonical UTC time,
24-hour freshness, sequence, previous digest, request identity, event uniqueness, transition order, and terminal
state. Prefix decisions are exact: awaiting candidate, awaiting comparison, canary planning required, manual
required, canary candidate, or rollback reference/manual required. Durable parsing always invokes this trusted
reducer; callers cannot inject replay behavior. Parsing validates hostile structures synchronously and snapshots
before the first digest await.

Comparison keeps prior and new version identities separate. Only the complete frozen metric set
`attachment-error-bps`, `dimension-error-bps`, and `geometry-error-bps` can derive better/equivalent; absent or
partial metrics derive manual-required, and any regression derives worse/manual-required. Metric digests remain
`metric-candidate-unverified` and do not constitute QA.

A better/equivalent comparison permits only canary planning; worse/manual-required permits only a rollback reference.
A canary is only a local plan for the exact bound SKU, 1..2,500 basis points, and 1..1,440 minutes, with explicit
later human and control-plane authority requirements. It never mutates Deployment or publication. A rollback plan
must equal the exact referenced prior unverified version/hash set, be older than the candidate, and remain named
`rollback-reference-manual-required`; it is not executable and automatic rollback is structurally false.

Every plan/command fixes `operationalStatus=local-preparation-only`, `g5Ready=false`, and false raw access,
generation execution, QA approval, promotion, live recommendation, Deployment mutation, publication, automatic
rollback, human/control-plane authority, and G1/G2/G5 evidence.

## Consequences

- Duplicate/relabelled, replayed/reordered, stale/future, cross-identity, roll-forward, wildcard/all-traffic,
  redigested plan/status/authority, TOCTOU, accessor/symbol/prototype/cycle/sparse/oversize inputs fail closed.
- The slice creates reproducible local preparation artifacts only. It performs no SQL, Supabase, R2, network,
  filesystem, raw-store, deployment, publication, or remote write.
- No physical, rights, actual-wear, device, production, G1, G2, or G5 evidence is claimed.
