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

## Consequences

- Current state, attempts, ownership, failure, and output are replay-derived.
- Missing, reordered, duplicate, altered, cross-identity, stale, and future
  evidence fails closed.
- Local evidence performs no Supabase, R2, Cloudflare, publication, approval, or
  network mutation.
- Recording synthetic Proxy output can reach review only. It grants no asset
  approval, publication, live recommendation, or G1/G2/G3 progress.
