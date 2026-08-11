# ADR-0007: Ground Truth evidence and promotion profiles

Status: Accepted
Date: 2026-08-11
Ticket: JSC-0209

## Context

The roadmap's J1-M single-frame technical slice and the high-level design's first canonical Ground Truth set have different cardinalities. The latter is 3 pseudonymous subjects × 5 distinct frame models × front/left/right = exactly 45 cells. The device design also requires five distinct classes, while the immediate project-state list previously highlighted only the two mobile live-camera runs. Treating any of these smaller slices as canonical G1 PASS would be a false promotion.

The quality document and data model also used different visual-review labels. A digest supplied by an evidence author is not proof that actual bytes were hashed.

## Decision

Two explicit profiles and gate names are used:

- `technical-single-frame-slice` → `TECHNICAL_SINGLE_FRAME_SLICE_READINESS`. This establishes tooling and metric calculation only. It is never G1 or canonical promotion.
- `canonical-validation` → `G1_CANONICAL_VALIDATION`. Promotion requires exactly 45 unique subject/frame-model/view cells, all per-fixture metrics, all evidence bindings, and the five separately evidenced device/browser classes.

`metricPass` reports only whether every supplied fixture's placement and non-vacuous temporal metrics meet thresholds. `gateReady` includes contract integrity, consent validity at deterministic `evaluatedAt`, coverage, visual review, sustained performance, operational scenarios, and device evidence. `canonicalPromotionReady` can be true only for the canonical profile when `gateReady` is true.

Canonical visual results use the exact quality-document enum: `approve`, `approve-with-envelope-limit`, `correction-required`, `manual-model-required`, `unsupported`. Legacy data-model labels map only in an explicit migration (`limited` → `approve-with-envelope-limit`, `correct` → `correction-required`, `manual` → `manual-model-required`); aliases are rejected at the promotion boundary.

Every artifact digest is accompanied by `actual-bytes-sha256`, verifier version, verification time, byte length, and the computed digest. Capture/render/trace and asset/source/manifest/model bindings must match. Raw consented actual-wear media stays outside Git; only pseudonymous metadata, digests, and provenance are committed or passed to CI.

Canonical anti-relabeling rules require unique capture/render/trace hashes per coverage cell; a stable variant/AssetVersion/model/manifest/width binding per frame model; distinct asset/model/manifest hashes across different frame models; one tenant per document; and a one-to-one subject/consent-reference relationship. Consent, review, and verification timestamps cannot be later than deterministic `evaluatedAt`.

Temporal evidence must observe motion, face loss followed by hide, and reacquisition. A stationary/no-loss trace cannot convert unobserved lag, lost latency, or reacquire jump into zero. Position jitter is RMS variation of the target-to-overlay residual vector around its mean, not RMS placement error. Rotation jitter uses a circular mean.

Canonical device evidence requires representative iPhone Safari, lower-end iPhone/SE, mid-range Android Chrome, Windows Chrome, and Windows Firefox as five unique classes. Each has 3-minute and 10-minute checkpoints, render FPS ≥24, detection FPS ≥15, memory/thermal evidence, plausible frame-count/duration consistency, and all operational scenarios from the decomposition design.

Device capture/render/trace hashes are unique per run, so one run cannot be relabeled as five classes. Coarse browser/OS families are bound fail-closed: iPhone uses Safari+iOS, Android uses Chrome+Android, and Windows Chrome/Firefox use the matching browser+Windows. Version strings remain unconstrained.

## Consequences

One perfect fixture can have `metricPass=true` while canonical `gateReady=false`. Missing or duplicate cells/devices, missing FPS, absent consent/visual/integrity evidence, vacuous traces, and per-fixture threshold violations all prevent promotion. Until real J1-M, consented 45-cell, and live-device evidence exists, JSC-0209 tooling may be complete but physical G1 remains active rather than PASS.
