# ADR-0029: Private authored Proxy GenerationJob submission

## Status

Accepted.

## Context

ADR-0027 creates a verified authored Proxy wrapper below the private root, and
ADR-0028 consumes an already queued ledger through the existing Proxy worker.
The remaining handoff required an operator to copy identity fields into a
`GenerationJobRequest`, create a queued event with an ad hoc Node pipe, and pass
that event to the general `frame:job:ledger` command. That exposed an unnecessary
opportunity to relabel the candidate or copy stale hashes and paths.

## Decision

`frame:job:submit:proxy-private` is the private submission adapter. It accepts
one private-root-relative ADR-0027 wrapper locator, one private-root-relative
ledger locator, a creation timestamp, and a retry bound of 1 through 10. The
private root comes only from `JESSICA_PRIVATE_SOURCE_ROOT`. It accepts no tenant,
model, generator, source, measurement, canonical-input, job, idempotency, event
digest, or authority value.

The adapter reads the wrapper with the shared bounded `O_NOFOLLOW` private
artifact reader and strictly verifies the complete authored wrapper. It derives
tenant/model identity, generator identity/configuration, the sorted source set,
measurement identity, and the actual canonical input digest from the verified
input. The existing GenerationJob kernel then derives the request identity and
canonical queued event.

The ledger is a traversal-free path below the same private root. Every created
or reused component below that root must be a real `0700` directory. The adapter
uses the existing immutable event writer for exclusive `0600` sequence-one
publication and the existing ledger reader/replay kernel for before-and-after
validation. An exact concurrent or later duplicate is successful and reports
reuse. Different sequence-one evidence, malformed/tampered evidence, symlinks,
permissive directories, and an unprovable append fail without overwrite.

The receipt is bounded to queued status, attempt policy, exact reuse, fixed
local-evidence-only/non-promotable authority, and `processingStarted:false`. It
contains no candidate identity, path, filename, job/event/input identifier, or
hash. The command never claims or processes the job, writes generation output,
creates review evidence, or invokes the worker. ADR-0028's Loop29 worker remains
the separate consumer of the queued ledger.

## Consequences

- Private submission no longer requires a hand-authored request/event or a
  general-purpose event-file handoff.
- Authored-wrapper relabel/tamper, traversal, symlinks, permissive storage,
  races, collisions, duplicate submission, replay failure, and receipt privacy
  are covered with synthetic automated evidence.
- The ledger and receipt remain local evidence only and non-promotable. This
  transaction makes no physical, J1-M, G1, G2, or G3 claim.
