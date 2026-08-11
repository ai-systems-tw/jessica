# ADR-0013: Capture-to-Proxy authoring provenance bridge

## Status

Accepted.

## Context

Capture authoring v1 binds five required labelled dimensions to inspected source
bytes. Proxy generation v1 requires six dimensions and a millimetre front
profile. Directly copying the five values, guessing thickness, or accepting an
unbound millimetre polygon would break provenance before the GenerationJob
boundary.

## Decision

`packages/frame-generation` owns a pure, versioned, unknown-field-rejecting
authoring bridge. It derives tenant/model and the sorted source SHA-256 set only
from a strict valid `FrameCaptureDraft`. Candidate variant/asset identity and
generator identity/config remain explicit, but callers cannot supply source
hashes, measurement/profile digests, tenant/model, canonical input digest, or
status/quality/live authority.

The bridge requires exactly the five capture evidence records and one explicit
thickness datum. Thickness is either unverified image/marking evidence bound to
one draft source, raw label, and optional half-open integer pixel region, or a
separately typed non-physical Proxy assumption with value, strict bounds,
reason, and limitations. It has no default. `verified` and `caliper` claims are
rejected until a separate trusted verification-artifact boundary exists.

The measurement digest covers the complete validated authored MeasurementSet,
the five canonically ordered evidence records, and the complete thickness
evidence/assumption. It does not mislabel profile evidence as measurement
evidence. Every transcribed raw label must contain an ASCII numeric token whose
numeric value equals its authored millimetre value. Decimal tokens and composite
markings are supported; absent/mismatched tokens fail. This checks supplied
text consistency and performs no OCR or image interpretation. Profile authoring
is either a deterministic dimension template with
explicit template identity/version and fixed contour-fidelity limitations, or a
manual image trace bound to one captured source SHA-256, a contained integer
pixel region, integer trace points, and explicit right/up pixel-to-millimetre
rules. Unbound millimetre polygons are rejected.

Legacy Proxy input v1 remains parseable. Bridge-authored v1 inputs additionally
carry strict `authoringEvidence`: the measurement digest, complete durable
thickness provenance, and a discriminated profile evidence body. Template bodies
retain template ID/version. Manual bodies retain source SHA-256, half-open
region, coordinate rules, and every integer trace polygon/anchor point. The
generator recomputes the canonical body digest and re-derives the millimetre
profile, requiring exact equality before generation. The evidence is copied into
the immutable manifest. Thus geometry-neutral template, trace-region, source,
reason, bounds, or limitation changes alter the job-bound input digest.
Assumption limitations also appear in manifest limitations.

The bridge produces only an explicit non-J1-M fixture candidate. Output remains
`draft`, `proxy`, `recommendedForLive:false`, calibration-only, and
non-promotable. ADR-0027 adds a private filesystem adapter and a strictly
verified authored wrapper without changing this pure bridge or granting the
wrapper any further authority.

## Consequences

- Capture authoring v1 parsing and assembly remain backward compatible.
- Five measurements can never silently become six; thickness absence fails.
- Manual traces are image/evidence-bound before millimetre profile validation.
- The existing GenerationJob and Proxy Worker bind the complete authored input
  through `generatorInputSha256`; the manifest preserves authoring provenance.
- No actual product image, physical verification, contour fidelity, rights,
  actual-wear, QA-preview, publication, Cloudflare/R2, or G1/G2/G3 authority is
  created.
