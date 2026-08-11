# ADR-0028: Private authored Proxy to GenerationJob adapter

## Status

Accepted.

## Context

ADR-0027 stores an authored Proxy wrapper below the private source root, but the
general generator and worker CLIs accept ordinary filesystem input paths. The
general generator's output files also use the process-default mode. Passing a
private candidate through that command therefore required an ad hoc path handoff
and a manual permission correction before the already strict GenerationJob
worker could be used.

The GenerationJob worker itself already binds the complete canonical generator
input, tenant/model, source set, measurements, and generator configuration
before claim. It deterministically generates, rereads and validates actual
manifest/GLB bytes, and records only `output-recorded`, leaving the job in
`review`. A second worker or generator implementation would weaken that single
boundary.

## Decision

`frame:worker:proxy-private` is the private adapter to the existing Proxy worker.
It takes only a private-root-relative authored-wrapper locator; the root comes
from `JESSICA_PRIVATE_SOURCE_ROOT`. The shared private artifact store walks
existing real parents, opens the final input with `O_NOFOLLOW`, bounds it to 1
MiB, and detects a changing read. The adapter parses the complete wrapper and
uses `verifyAuthoredProxyGeneratorInput` to recompute its canonical input digest,
provenance, authoring limitations, and fixed authority before delegating its
verified input. Traversal, absolute paths, symlink parents/finals, non-regular
entries, oversized input, malformed JSON, and wrapper substitution fail before
claim.

The existing worker remains the only generation/job transition implementation.
For this adapter it selects the private output-store mode. Both output files are
fully written and synced in exclusive same-directory `0600` temporary inodes
before publication. Each final filename is published with an atomic hard link
that cannot replace an existing entry. The final bytes and mode are reread with
`O_NOFOLLOW`; a pre-existing pair is reusable only when both complete byte
sequences match and both modes are exactly `0600`. A different, partial,
symlinked, or permissively-mode pair is a collision and is never overwritten.
On failure, only invocation-owned inodes are removed, with inode identity checked
before removal.

The filesystem cannot atomically expose two final names and a ledger event as
one transaction. As in ADR-0011, both file inodes are individually atomic and
exclusive, a failed pair publication is cleaned when ownership can be proved,
and recovery relies on exact-pair verification plus ledger replay. No stronger
cross-file transaction claim is made.

The generator serializes the manifest canonically, so equivalent strict input
objects cannot change output bytes merely through JSON property insertion order.
The general `frame:proxy:generate` and `frame:worker:proxy-auto` commands remain
available for public/synthetic workflows and retain their existing interfaces.

The private receipt is deliberately smaller than the worker result. Success
reports only `review`, attempt count, exact-pair reuse, fixed authority, and
unchanged gate disclaimers. Failure reports a stable error classification and
recovery flags. It emits no candidate bytes, tenant/model/job identity, input or
output locator, filename, source/output hash, evidence object, or absolute path.

## Consequences

- A private authored wrapper can reach the existing deterministic worker and
  digest-bound GenerationJob `review` state without copying it to a general input
  location or manually changing output permissions.
- Output remains fixture, `draft`, `proxy`, `recommendedForLive:false`,
  calibration-only, and non-promotable. The adapter cannot append `completed`,
  create a QA decision, derive an approved asset, publish, deploy, or enable
  QA-preview/public-live admission.
- This is photo-independent storage and execution hardening. It establishes no
  physical, contour-fidelity, actual-wear, rights, J1-M, G1, G2, or G3 claim.
