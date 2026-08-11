# ADR-0030: Non-Proxy evidence-candidate boundary

## Status

Accepted.

## Context

Standard and manual assets will eventually need physical, visual-fidelity,
actual-wear, and rights evidence. The local repository can bind claimed evidence
digests to a reviewed GenerationJob, but it cannot yet inspect authoritative
evidence bytes, prove source/capture identity, validate consent or rights scope,
or establish a publication authority.

Treating a correctly shaped SHA-256 string as a verified fact would turn a local
JSON author into an approval authority. That is unsafe and would permit false
promotion.

## Decision

`nonProxyQaReview` is versioned and strict. It requires four evidence references,
each binding an evidence digest, one source digest from the exact GenerationJob,
and that job's exact MeasurementSet digest. The decision binds the immutable
GenerationJob review head, actual manifest/GLB hashes and byte lengths, and the
candidate identity/geometry fields. Proxy jobs, Proxy quality, and mismatched
generation methods are rejected.

These references remain **unverified evidence candidates**, not positive physical,
visual, actual-wear, consent, rights, approval, or publication claims. An accepted
candidate can derive only an immutable local evidence-candidate `draft` with
`admission: unverified-evidence-candidate`, `promotable:false`,
`recommendedForLive:false`, `fixtureStatus:unverified`, and a frozen authority
denial object (`qaApproved`, `assetVersionCreated`, `assetVersionPromoted`,
`recommendedForLive`, `activeDeployment`, `publication`, and `gates` are all
false). It cannot derive an AssetVersion, `review`, `approved`, `published`,
deployment, or runtime-live admission. Rejection derives no candidate.

Candidate model/manifest locators are bounded to contained relative references or
exact credential-free HTTPS URLs. Candidate matrices and issue categories use
dense closed structures, UTC instants are canonical, and application inputs are
snapshotted before the first asynchronous ledger/digest operation so caller
mutation cannot relabel the resulting evidence candidate.

## Consequences

- The candidate provides a strict hand-off format for a future byte-verifying,
  authority-bound evidence adapter without allowing a hash-shaped assertion to
  promote an asset.
- The existing Proxy calibration boundary remains permanently non-promotable.
- A future implementation must verify evidence bytes and source/capture/
  MeasurementSet lineage, scoped rights and consent, actual-wear subject binding,
  actual non-fixture artifacts, and authorized human decision before it can introduce a
  review/approved/publication transition.
- No network, storage, Supabase, Cloudflare, deployment, signing, publication, or
  external evidence mutation is introduced.
