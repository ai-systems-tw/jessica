# ADR-0032: Marking inspection and verified source provenance

## Status

Accepted.

## Context

JSC-0212 verifies non-Proxy evidence bytes while intentionally fixing every
source descriptor at `sourceRole:null`. A filename, caller-selected role, or the
statement `reported-no-temple-marking` does not prove which physical surface was
photographed, that all photographs show one specimen, or that the closed set of
marking surfaces was inspected. Treating that report as formal absence would
also create an invalid shortcut around verified measurements and G1 source
requirements.

The seven private A3893_S9 photographs are user-confirmed photographs of a real
product, and the user reports that this physical frame has no temple marking.
Those facts do not yet include the signed capture-role, same-specimen, or
surface-inspection evidence required by this decision. The private archive,
photographs, and `.env` remain outside the repository.

## Decision

Add versioned strict contracts and the pure
`JSC-0213_MARKING_INSPECTION_AND_SOURCE_PROVENANCE` evaluator. It accepts the
complete strict non-Proxy candidate, its exact actual source bytes, one actual
canonical `reported-no-temple-marking-attestation` byte artifact, and three
independent host-trusted ES256 attestations. The report attestation authenticates
the reporter/actor, report time, identity, and validity window; canonical bytes
alone are not treated as an authenticated report.

The capture-provenance attestation binds the candidate digest, tenant/model/
variant/job, exact sorted source set, actual `{artifactId, kind:source,
sourceRole:null, sha256, byteLength}` descriptors, a specimen ID, one capture
claim per source, capture roles, and capture times. Source artifacts themselves
remain `sourceRole:null`; `front`, side, and `marking` roles exist only in the
verified signed mapping.

The marking-inspection attestation independently binds the same candidate,
source set and specimen, the complete capture-provenance payload digest, the
inspector and inspection time, and the actual report artifact it supersedes. A
host-only `expectedSupersededAttestationSha256` identifies the accepted lineage
head, so a request cannot select an older report. The fixed policy
`eyewear-dimension-marking-closed-surfaces` version 1 has temples and covers the
exact canonical set:

- left temple inner surface;
- right temple inner surface;
- bridge inner surface.

Every surface must use distinct actual bytes whose signed capture role is
`marking`. Missing, duplicate, extra, reordered, unknown, differently identified,
future, stale, cross-specimen, cross-candidate, digest-substituted, unsigned-role,
or invalidly signed evidence fails closed. Trust roots, evaluation time, maximum
lifetimes, maximum evidence age, and expected lineage head are host-only inputs
and are snapshotted before asynchronous verification.

If every surface reports `no-dimension-marking-observed`, the evaluator derives
only `no-dimension-marking-observed-under-policy` and marks only the marking-
transcription route `not-applicable-under-policy`. If any surface reports a
dimension marking, the outcome is `dimension-marking-observed-under-policy` and
the transcription route remains required. The policy concerns dimension/size
markings; it does not claim that branding or every possible inscription is
absent.

Both outcomes explicitly retain the requirement for all six verified-caliper
measurements and the J1-M/G1 `marking` source requirements. Output authority denies QA approval,
AssetVersion creation/promotion, live recommendation, active Deployment,
publication, and every gate.

## Consequences

- `reported-no-temple-marking` and policy-derived absence are separate states.
- JSC-0212 and its `sourceRole:null` descriptors are unchanged.
- Verified roles cannot be copied back into, or substituted for, JSC-0212
  artifacts; they are derived only from the signed provenance payload.
- Same-specimen evidence is a cross-binding across report, candidate, complete
  source set, provenance payload, and inspection—not merely a repeated string.
- A successful synthetic evaluator test proves contract behavior only. It does
  not formalize the current private A3893 evidence and does not pass J1-M, G1,
  G2, AssetVersion, publication, or Deployment gates.
- The evaluator performs no filesystem, database, network, Supabase,
  Cloudflare, object-store, approval, or publication mutation.
