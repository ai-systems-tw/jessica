# ADR-0012: QA decision evidence and Proxy AssetVersion draft derivation

## Status

Accepted.

## Context

The local Proxy Processing Worker ends at a digest-bound GenerationJob `review`
state. Wave D1 needs a human approve/reject boundary and an immutable
AssetVersion draft, but the current G1 gate does not authorize product approval,
publication, deployment, live recommendation, or fabricated physical evidence.
A mutable QA row or caller-supplied AssetVersion would permit job/output
substitution, status escalation, URL relabeling, or unsupported evidence claims.

## Decision

QA decision evidence is schema-versioned, rejects unknown fields, and is one
terminal canonical SHA-256-bound record for one exact reviewed output. It binds
tenant, model, job, processing identity, review ledger head, generator input,
manifest/model SHA-256, and actual byte lengths. Reviewer identity and explicit
`reviewedAt`/`evaluatedAt` are mandatory. Issue categories are bounded, unique,
sorted, and enum-constrained; notes are null or bounded trimmed control-free
text. Reject requires at least one category. Approve carries none. There is no
automatic decision path.

For the current Proxy-only slice, physical requirements, visual fidelity,
actual-wear, and rights remain mandatory `false` with evidence digests mandatory
`null`. A caller cannot assert those requirements through this contract.

An approve decision means only “derive the reviewed calibration draft.” It does
not mean AssetVersion status `approved`. The pure derivation regenerates the
strict deterministic Proxy bundle from the exact job-bound generator input and
requires its manifest/model hash and byte lengths to equal the GenerationJob
review output. Asset identity, version, variant, content-addressed URLs, source
hashes, generator provenance, attachment, envelope, and status are derived;
none are accepted as caller labels. The result is fixed to fixture, `draft`,
`proxy`, `recommendedForLive:false`, `calibration-only`, and `promotable:false`.
Reject derives no AssetVersion.

The boundary has no storage adapter. Canonical replay and derivation are pure,
so concurrent identical calls return identical evidence without introducing a
second CAS/recovery protocol. A persistent QA adapter can be added later only
with the existing no-follow, containment, immutable-write, and privacy policy.

## Consequences

- Unknown, tampered, duplicate, absent, multiple/reordered, future, stale, and
  cross-identity decisions fail closed.
- Proxy QA approval cannot produce an approved, published, deployed, QA-preview,
  or public-live asset.
- Physical/visual/actual-wear/rights blockers remain explicit and machine
  readable.
- No network, Supabase, R2, Cloudflare, deployment, publication, or physical
  evidence mutation is introduced.
- G1 remains active with its external blockers unchanged; G2/G3 are not active
  or passed.
