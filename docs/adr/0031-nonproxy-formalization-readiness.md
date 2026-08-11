# ADR-0031: Non-Proxy formalization-readiness verification

## Status

Accepted.

## Context

ADR-0030 deliberately treats the four evidence references on a non-Proxy
candidate as unverified digest-shaped claims. A caller-authored digest is not
proof that bytes exist, that an authorized actor reviewed them, or that the
evidence belongs to the reviewed GenerationJob and product identity.

Building a Standard worker, AssetVersion transition, or publication adapter on
those references would create a false-promotion path. The next boundary must
therefore verify evidence before an authorized human review can begin, while
remaining unable to approve or publish anything itself.

## Decision

Add a pure `JSC-0212_NON_PROXY_FORMALIZATION_READINESS` evaluator. Its input is
the complete JSC-0211 `NonProxyEvidenceCandidateDraft` plus the canonical
GenerationJob ledger and QA-decision bytes, not a second caller-authored
summary. The evaluator replays the JSC-0211 derivation and rechecks every frozen
denial:

- Standard/Premium and non-Proxy generation only;
- exact candidate, tenant/model/variant, GenerationJob, generator, output,
  source, MeasurementSet, matrix, and envelope bindings;
- `fixtureStatus:unverified`, `status:draft`,
  `admission:unverified-evidence-candidate`, `promotable:false`, and
  `recommendedForLive:false`;
- all QA, AssetVersion, live, Deployment, publication, and gate authority flags
  remain false.

The evaluator accepts only bounded in-memory byte artifacts. It snapshots them
before its first asynchronous operation, recalculates every SHA-256 and byte
length, enforces kind-specific plus aggregate byte budgets, rejects digest or ID
reuse, requires the exact candidate source set, and requires exactly one
measurement document, visual capture, consented actual-wear capture, rights
record, GLB, manifest, GenerationJob ledger and QA decision. It strictly parses
the canonical verified-caliper document and manifest, validates the GLB with the
shared metre/node/bounds kernel, and deterministically replays the job/decision
to the exact candidate.

Exactly four ES256 attestations are required: physical measurement, visual
fidelity, actual-wear consent, and rights clearance. Each signature binds:

- the complete candidate digest and exact tenant/model/variant/job identities;
- canonical input, review head, generator input, MeasurementSet and source set;
- actual model/manifest hashes and lengths;
- sorted `{artifactId, kind, sourceRole:null, sha256, byteLength}` descriptors;
- one scope-specific claim, issuance/expiry, and the applicable consent or
  rights fields.

Physical evidence covers lens width, bridge width, temple length, frame width,
lens height, and frame thickness in canonical order. Every value must exactly
match the canonical verified measurement bytes and physical source. This version
requires caliper evidence for all six values; marking transcription remains
closed until a separate marking-inspection boundary exists. Actual-wear evidence binds a pseudonymous subject,
consent and unexpired retention horizon. Rights are deliberately limited to
`internal-review-only`.

The host supplies the evaluation clock and an exact
`keyId → tenantId + authorityId + allowed scopes + public P-256 JWK` trust map as
a separate non-request argument. Trust roots and time are never deserialized
from the evidence package. Four independent public-key fingerprints and
authorities are required.
Private keys, unexpected JWK
fields, unsupported scopes, stale/future evidence, wrong authority, and invalid
signatures fail closed. Input objects and arrays reject accessors, symbols,
custom prototypes, sparse entries, unknown fields, and post-call relabelling.

A complete package returns only
`evidence-package-verified-for-authorized-human-review-input`, with an explicit
evaluation time, shortest validity horizon and signed-payload digests. Its frozen authority object still denies
QA approval, AssetVersion creation/promotion, live recommendation, active
Deployment, publication, and all gates.

## Consequences

- JSC-0211 cannot be bypassed by inventing a smaller formalization binding.
- Actual bytes, job/decision replay, structured measurement/manifest/GLB checks,
  and authorized scoped signatures replace hash-shaped assertions before human
  review input eligibility.
- The evaluator validates evidence integrity and authority binding; it does not
  prove that a human statement is factually true.
- It creates no AssetVersion, approval, database mutation, object-store write,
  network request, publication, Deployment, or runtime admission.
- A separate marking-inspection contract is still required to derive
  `no-dimension-marking-observed-under-policy`; user-reported absence alone never
  supplies a marking source or verified dimension.
- Source roles are deliberately not asserted here: source bytes are bound by
  digest to the replayed job, while front/side/marking semantics require a later
  verified capture-provenance or marking-inspection contract.
- Opaque source, visual, actual-wear and rights record contents remain statements made by
  their host-trusted scope authorities. JSC-0212 proves their exact bytes,
  signature, identity, time and limited scope; it does not infer their factual
  truth or grant review authority.
