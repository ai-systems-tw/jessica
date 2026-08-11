# ADR-0011: GenerationJob replay and local evidence ledger

## Status

Accepted.

## Context

Wave D/D3 needs deterministic job claims, retry classification, output evidence,
and no-overwrite persistence before a database or Processing Worker exists. A
mutable current-state JSON file would permit status relabeling, ownership loss,
output substitution, or silent history replacement.

## Decision

GenerationJob v1 is reconstructed only from strict, canonical SHA-256 chained
events. The processing identity includes tenant, model, method, generator
identity/version/config digest, sorted source digests, measurement digest, and
generator-input digest. Submission time and retry policy remain committed in the
queued event but do not change same-processing-input idempotency.

Only queued jobs can be claimed. Claims increment attempts, bind worker/token and
a maximum 15-minute lease, and authorize running transitions only before expiry.
Exact expired-claim evidence can return a job to queued; it cannot create a second
owner. Retry requires the current explicitly retryable failure and remaining
attempts. Completed and cancelled histories are immutable. Review completion
must repeat the exact manifest/model hash and byte-length evidence recorded by
the worker.

Replay requires an explicit UTC `evaluatedAt`; no pure-core path reads the wall
clock. Event occurrence after that cutoff is rejected, while a bounded active
claim may have a lease expiry after the observation horizon. Lease recovery
still cannot occur before the exact recorded expiry. The local CLI
walks the output path component by component without following symlinks, writes
canonical bytes through an exclusive temporary file and atomic hard link into
one sequence-number CAS slot, and accepts an existing event only when its
canonical bytes match exactly. Different bytes/digests for the same sequence
collide, preventing concurrent appenders from forking one replay head.

The local proxy-auto Processing Worker composes this ledger with the
deterministic Proxy generator. It accepts only a queued `method=proxy-auto`
request and compares the canonical digest of the actual strict generator input,
tenant/model, sorted source set, measurement digest, and generator
id/version/config digest before claim. It then claims through the same atomic
sequence CAS. Standard-auto, manual, and external are outside this runner.
The runner additionally requires a live synchronous explicit timeline before
CAS: `claimedAt` is earlier than both possible result timestamps, both results
are no later than `evaluatedAt`, and `evaluatedAt` is strictly earlier than
`leaseExpiresAt`. Result events remain strictly before lease expiry under the
existing reducer. This prevents a newly backdated claim whose lease is already
expired at the observation horizon.

After local generation, the Worker rereads both immutable files. It computes
SHA-256 and byte length from actual bytes, reconciles manifest-to-GLB URL/hash/
length and complete source/generator/candidate identity, requires fixed fixture,
draft, Proxy, non-live, calibration-only authority, and validates the GLB with
the shared assets kernel before appending `output-recorded`. It does not append
`completed`.

Failure classification is fixed as follows:

| Condition | Classification | Retry condition |
| --- | --- | --- |
| canonical input, identity, generator/config, or policy mismatch | terminal | none; repair the queued request/input through a new valid history |
| malformed, tampered, hash/length/URL/identity-mismatched manifest or GLB | terminal | none; investigate immutable evidence |
| required reread file missing, symlink-swapped, or non-regular | terminal output validation | no-follow; clean only invocation-created paths and prove cleanup |
| pre-existing different or half-present content-addressed output | terminal | none; preserve it for investigation |
| local write/read I/O after claim | retryable only when clean | no invocation-created partial remains; an exact complete pair may be reused |
| output event append I/O | retryable only when owned | exact claim remains the ledger head and verified immutable output is unchanged |
| claim sequence CAS contention | no owned failure event | losing runner stops; replay the winning ledger head |
| claim append reports after possible publication | replay-resolved | continue only for the exact claim head; unchanged prior head means no claim; competing head means contention |
| claim append outcome cannot be replay-proven | terminal/recovery-required | inspect the immutable sequence slot before any retry |
| cleanup cannot be proven | terminal/recovery-required | no automatic retry |

The local filesystem cannot atomically commit an output pair and a ledger event
in one transaction. Recovery is therefore exact and manual: replay the ledger;
if it is already `review`, verify its recorded hashes against the files and stop;
if it is `running`, do not start a second worker before the exact lease expiry;
after expiry append the existing `lease-recovered` event bound to the old claim,
then follow the existing retry policy. If a sanitized `failed` event is present,
append `retry-queued` only when it is explicitly retryable and attempts remain.
On rerun, exact complete content-addressed bytes are reread and reused; different
or half-present bytes are never overwritten or deleted. If the Worker reports
`recoveryRequired`, inspect the ledger head and output pair before any mutation.

Filesystem policy errors are classified before generic validation errors:
invalid explicit roots report sanitized `ROOT_INVALID`, while traversal or
symlink containment failures report sanitized `OUTPUT_CONTAINMENT`. They are
terminal policy failures, not generator-input identity failures.

An error returned by the claim hard-link operation is ambiguous because the
link may already be visible. The worker therefore rereads before deciding: the
exact proposed claim head is treated as acquired and processing continues; the
unchanged prior head proves no claim; another valid head is contention. If the
ledger cannot prove one of those states, the worker returns
`CLAIM_COMMIT_UNPROVEN` with `recoveryRequired:true` and performs no output work.

## Consequences

- Current state, attempts, ownership, failure, and output are replay-derived.
- Missing, reordered, duplicate, altered, cross-identity, stale, and future
  evidence fails closed.
- Local evidence performs no Supabase, R2, Cloudflare, publication, approval, or
  network mutation.
- Recording synthetic Proxy output can reach review only. It grants no asset
  approval, publication, live recommendation, or G1/G2/G3 progress.
- Cross-filesystem transactional atomicity is not claimed; the fail-closed
  recovery procedure above is part of the boundary.
