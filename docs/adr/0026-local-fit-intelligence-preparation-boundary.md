# ADR-0026: Local product-size Fit Intelligence preparation boundary

## Status

Accepted for G7-A local preparation. G7 remains not active and not passed.

## Context

W9/G7 calls for relative-size guidance, similar-size recommendation, explanation, and outcome measurement. The
repository does not yet have J1-M physical inputs, calibrated face-width/device evidence, real-user outcome
semantics, representative rights-cleared production operations, or publication authority. Portrait-derived
dimensions, interaction-to-purchase inference, and personal suitability claims would invent evidence.

## Decision

G7-A accepts only one strict `g7-a-local-v1` product candidate set. Each reference and candidate binds exact
tenant/site/production, SKU/FrameModel/FrameVariant, five explicit millimetre fields, a MeasurementSet digest, a
source-set digest, and a derived candidate digest. The upstream `verified-physical-mm` label is only a candidate
assertion. The local boundary does not authenticate it; evaluation reports
`measurement-source-catalog-digest-references-unverified` and denies physical-measurement, source, and catalog
authority.

The frozen non-production candidate policy is intentionally simple and externally unvalidated:

| Dimension | Comparable threshold | Integer-score weight |
| --- | ---: | ---: |
| frame width | 3 mm | 40 |
| lens width | 2 mm | 20 |
| bridge width | 2 mm | 15 |
| lens height | 2 mm | 10 |
| temple length | 5 mm | 15 |

A candidate is eligible only when every absolute difference is at most twice its threshold. Its integer score is
the sum of `round(abs(delta mm) × 1000) × weight / threshold mm`, rounded per dimension. Lower is nearer. Results
are capped at five and ordered by score, then canonical SKU/FrameModel/FrameVariant tuple, then candidate digest.
Every dimension emits a closed smaller/comparable/larger relation; closed comparable/different explanation codes
are exhaustive alongside those relations. The only text is fixed reference-product guidance and explicitly says
personal suitability is not assessed.

Input parsing, not only evaluation, enforces exact scope, canonical ordering, uniqueness, model-stable measurement
identity, and exclusion of the reference tuple/digest. A shared FrameModel must retain the same MeasurementSet
digest, five values, and verification label across variants; source-set digests may remain variant-specific.
Missing/invalid measurement shapes fail. An unverified reference routes manual/unavailable; an unverified candidate
is explicitly excluded.

Face/frame relative-width guidance is fixed to
`deferred-calibrated-physical-device-evidence-required`. Outcome measurement is fixed `pending-external` with
causal semantics undefined, measurement false, and interaction-to-purchase inference false. No occurrence ledger
is introduced in this slice.

Evaluation and command verification replay the immutable input and reject redigested output, readiness, ranking,
or authority escalation. Every result is `local-preparation-only`, `g7Ready:false`, and denies recommendation
publication, personalization, physical suitability guarantee, medical/biometric inference, catalog mutation,
analytics/remote write, and G1/G2/G5/G6/G7 evidence.

## Consequences

- This can compare listed product dimensions and prepare deterministic similar-size candidates locally.
- Thresholds and weights are policy guesses pending external validation; they are not production selection policy.
- No photo, image path/URL, landmark, pose, face geometry, person, user, session, free-form text, filesystem,
  network, SQL, Supabase, R2, catalog mutation, analytics sink, or production adapter is added.
- Recommendation publication, personalization, personal suitability, comfort, outcome, causal, and gate claims
  remain future work with separately designed authority and evidence.
