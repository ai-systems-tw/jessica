# ADR-0014: Local private capture-draft artifact transaction

## Status

Accepted.

## Context

Capture authoring could validate and print a complete draft, but shell
redirection was not a safe durable evidence boundary: npm banners could corrupt
JSON, redirection could truncate an existing file, permissions depended on the
shell, and no receipt proved the bytes actually stored. The candidate image is
not available, so this decision must not create or infer product evidence.

## Decision

`frame:capture:author` retains its stdout-only mode and adds explicit
`--output-path <relative-path>` mode. Output mode is available only when
`JESSICA_PRIVATE_SOURCE_ROOT` is explicitly configured and canonically resolves
to an existing directory. The target is below that canonical root. Empty,
absolute, Windows-absolute, dot, traversal, and NUL paths are rejected. Every
parent must already be a real directory; symlink/non-directory parents and any
existing final entry, including a symlink, fail closed.

The filesystem adapter canonicalizes the draft with a trailing newline, opens a
random same-directory temporary file exclusively with mode `0600`, reapplies and
verifies that mode, writes and flushes all bytes, and atomically hard-links it to
the absent final name. It never accepts idempotent replay and never overwrites.
It opens the final path with `O_NOFOLLOW`, requires the same regular-file inode,
compares exact bytes, and derives receipt SHA-256 and byte length only from that
reread. It syncs the parent directory before removing the temporary name.
Normal write, verification, and collision failures remove invocation-created
temporary state; post-link failures remove the final name only when it still
identifies the invocation's inode.

Crash atomicity is explicitly limited to one filesystem directory. Before the
hard link, no final artifact exists, although a recognizable private temporary
file may remain. After the hard link, the complete flushed inode is present at
the final name, while the temporary hard link may remain until manual cleanup.
No partially written final name is exposed and no existing final name is
clobbered.

Output-mode stdout is a sanitized receipt containing only success,
`draftValid`, independent `g1Ready`, and the artifact's relative locator,
actual-byte SHA-256, and actual byte length. Users parsing it through npm must
use `npm --silent run`. Errors contain stable classes and generic messages, not
stacks, draft contents, source hashes, or absolute private paths.

## Consequences

- A valid single annotated overview may be durably stored while correctly
  reporting `g1Ready:false`.
- The artifact is local private draft evidence only. Persistence grants no
  transcription verification, rights clearance, J1-M identity, promotion,
  approval, publication, Cloudflare/R2 state, or G1/G2/G3 authority.
- Parent directories are deliberately not created by the command, which keeps
  containment inspection and failure cleanup deterministic.
- No production dependency, network operation, or cloud adapter is added.
