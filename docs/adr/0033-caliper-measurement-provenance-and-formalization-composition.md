# ADR-0033: Caliper measurement provenance and formalization composition

## Status

Accepted for JSC-0214.

## Context

JSC-0212 verifies the canonical six-value measurement document and its signed
physical claim, but the `method=caliper` label does not by itself prove a real
measurement session, a calibrated instrument, or the same specimen established
by JSC-0213. That semantic gap could allow five annotated-image values plus an
assumed thickness to be rewritten as six caliper-labelled values.

## Decision

Add a pure `evaluateCaliperMeasurementProvenance` composition boundary. The
request contains only the complete JSC-0212 request, complete JSC-0213 request,
two dedicated actual-byte artifacts, and their attestations. The host supplies
the clock, JSC-0212/JSC-0213 trust, expected report/calibration/session lineage
heads, and caliper trust. Caller-authored cached readiness/results, clocks,
trust, lineage, public keys, or approval are not request fields.

The calibration record and measurement session are strict canonical UTF-8 JSON
v1 bytes with dedicated kinds, bounded length, actual SHA-256, and
`sourceRole:null`. Their IDs and digests must be unique and cannot equal source
or existing evidence digests. The session has the closed signed discriminator
`direct-physical-caliper-observation`; annotated images, marking transcription,
reported absence, user absence, inferred values, and assumed thickness are not
members of this contract.

The session binds one tenant/model/variant, specimen, operator, observation
instant, caliper, calibration record/payload/validity, candidate, GenerationJob,
sorted source set, exact MeasurementSet, and recomputed capture-provenance
payload. It contains exactly the canonical six fields in order. Every item is a
direct `caliper` observation in `mm`, has the same atomic observation instant,
and exactly matches the canonical JSC-0212 measurement document's field, value,
method, and source.

JSC-0212 and JSC-0213 are internally re-evaluated from their raw requests using
host context; their candidates must be exactly identical. The measurement
authority, key ID, and host JWK fingerprint must exactly match the JSC-0212
physical-measurement authority/key. Calibration and measurement use independent
tenant-scoped ES256 authorities, key IDs, and public P-256 JWK fingerprints.
Fingerprints are recomputed from the host JWK. Calibration must predate and
cover all observations, remain valid at evaluation, and satisfy host maximum
calibration and observation ages.

The digest-only result retains the canonical signed payload SHA-256 for both the
verified calibration attestation and measurement attestation, in addition to
record/session payload digests. Downstream review can therefore bind the exact
attestation provenance rather than only unchanged record/session bytes.

All nested objects, contexts, and byte arrays are synchronously checked and
copied before the first asynchronous operation. Accessors, custom prototypes,
sparse arrays, symbols, and structural/byte-budget excess fail closed.
Typed-array budgets use the intrinsic backing-store byte length; hostile own
`byteLength` getters/data shadows cannot execute or under-report, and proxies
without genuine typed-array internal slots fail closed.

## Consequences

A valid package returns only the frozen digest result
`caliper-provenance-verified-for-authorized-human-review-input`, a bounded
validity horizon, and explicit false authority flags. It exposes no specimen,
operator, caliper, raw observation values, raw evidence, QA decision, or
AssetVersion. QA approval, AssetVersion creation/promotion, live recommendation,
Deployment, publication, and every gate remain false.

Synthetic fixtures exercise the boundary. No private A3893 bytes, archive, or
`.env` are committed, and no claim is made that an authorized physical
measurement session exists. Authorized human QA decision handling is reserved
for JSC-0215 or later.
