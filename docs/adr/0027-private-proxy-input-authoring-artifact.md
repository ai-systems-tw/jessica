# ADR-0027: Private capture-to-proxy input authoring artifact

## Status

Accepted.

## Context

ADR-0013 defines a pure strict `FrameCaptureDraft` to `ProxyGeneratorInput`
bridge, while ADR-0014 defines safe private capture artifact publication. A
private valid capture draft could not be passed through that bridge without an
ad hoc script, copying private content to stdout, or manually copying derived
digests. A bare wrapper around a Proxy input would also be unsafe if the
generator trusted its claimed digest or authority without verification.

## Decision

`frame:proxy:input:author` is the only filesystem adapter for this bridge. It
requires an explicit `.env.local`/environment configuration named
`JESSICA_PRIVATE_SOURCE_ROOT` and requires both an authoring-envelope filename
and `--output-path <relative-path>`. The v1 envelope has exactly three fields:
`schemaVersion:1`, a private-root-relative `captureDraftPath`, and the strict
ADR-0013 authoring object. It cannot carry source hashes, measurement/profile
digests, tenant/model identity, canonical/output hashes, status, authority,
publication state, URLs, or raw media.

The private capture draft is read below the canonical existing root through a
bounded no-follow handle. Dot/traversal/absolute paths, symlink or non-directory
parents, symlink/non-regular final entries, oversized bytes, and changing reads
fail closed. The outer envelope is independently bounded and must also be a
regular no-follow file. JSON semantic exactness is enforced by
`authorProxyGeneratorInput`, which derives all source, measurement, profile,
candidate-input, and provenance digests rather than accepting them from the
operator.

The output uses the generalized ADR-0014 private artifact transaction: all
parents must pre-exist as real directories; the command creates no parent,
follows no final symlink, never overwrites, and rejects an input/output path
collision. It publishes canonical JSON plus one newline through a same-directory
exclusive `0600` temporary inode, hard-link no-replace, exact no-follow reread,
mode/inode/byte verification, and directory sync. The persisted value is the
complete authored result: strict `input`, recomputed `canonicalInputSha256`, and
fixed provenance.

The receipt contains only `ok`, the private-root-relative output locator and its
actual reread SHA-256/byte length, the canonical Proxy input SHA-256, and the
fixed authority `{fixture:true,status:"draft",quality:"proxy",
recommendedForLive:false,admission:"calibration-only",promotable:false}`. It
contains no capture content, source hashes, authoring echo, or absolute path.
Stable sanitized errors contain no stack or private values.

`frame:proxy:generate` remains backward compatible with a bare strict
`ProxyGeneratorInput`. When given the authored wrapper, it first calls the core
`verifyAuthoredProxyGeneratorInput`: exact wrapper/provenance shapes are
required, the embedded input must already be canonical, its digest is
recomputed, provenance is cross-checked against durable authoring evidence, and
the authority must equal the fixed non-promotable value. Only the verified
`.input` is passed to generation. Blind unwrapping and caller-supplied digest
copying are forbidden. Method-specific limitation text and
`contourFidelity:false` are canonical fixed policy, not caller-selected fields;
even a wrapper whose input hash and duplicate provenance text have both been
freshly recomputed is rejected when that policy text changes.

This verifier establishes deterministic structural and replay consistency. It
does not cryptographically authenticate the wrapper's origin, machine, or
operator. Adding capture-draft or outer-envelope hashes to this wrapper without
retaining those inputs at generator time would create unverifiable claims, so
v1 does not add them. The private `0600` artifact transaction remains the local
source boundary, and production authority remains explicitly false.

## Consequences

- Identical capture and authoring data produce identical stored authored bytes
  and Proxy identity; source, measurement/evidence, or authoring changes are
  digest-bound.
- The durable artifact feeds the existing generator CLI without manual digest
  handling, while wrapper digest/authority tampering fails strict validation.
  ADR-0028's private adapter is the preferred route from this artifact into the
  existing GenerationJob worker and private `0600` output store.
- The committed example is visibly synthetic and names no real candidate path,
  source, or product asset.
- The artifact is a private fixture draft only. It grants no transcription or
  physical verification, rights, approval, publication, production authority,
  or G1/G2/G3 readiness.
