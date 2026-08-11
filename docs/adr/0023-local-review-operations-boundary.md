# ADR-0023: Local fail-closed review operations boundary

Status: Accepted for local preparation only

## Context

Wave F3 needs deterministic routing between automatic-review candidates, correction, later human review, and
rejection. The repository has no authenticated production review queue, source-evidence authority, authorized
human-review service, or operational integration. Treating a caller-supplied digest or an “auto” result as QA,
promotion, publication, or gate evidence would cross the authority boundaries in ADR-0012, ADR-0016, ADR-0021,
and ADR-0022.

## Decision

Use strict schema-v1 work-item, evidence-chain, queue, and command contracts. Every work item and evidence event
binds tenant/site/production, SKU/FrameModel/FrameVariant, GenerationJob identity, canonical/generator input and
review-head candidates, reviewed manifest/model hash and byte-length candidates, asset/version candidate,
`f3-local-v1`, nonzero source/capture digest candidates, and nullable F1 demand-command/F2 batch-log digest
candidates. The fixed `candidate-references-unverified` label means hashing proves only exact local integrity.
It does not prove upstream ledger replay, source authenticity, capture operation, rights, or production authority.

Every evidence event fixes `evaluationAuthority` to `local-candidate-unverified`. `evaluatorId`,
`evaluatorVersion`, and findings are bounded local candidate labels, not authenticated human-review identity or
source proof, regardless of caller-chosen naming. Finding, reason, and outcome allowlists are frozen runtime tuples;
a consumer cannot mutate an exported array to enlarge parser acceptance.

No contract includes F1/F2 payloads, `localraw:` references, bytes, filesystem paths, URLs, media, people/session/
camera/biometric data, free-form notes, commerce, or analytics payloads. The application layer has optional injected
clock/read/write ports only and accepts exact `accepted` or `idempotent` acknowledgements.

The contract-owned pure reducer preserves caller append order. It accepts an exact retry only immediately after
the original event, verifies canonical event/work hashes, repeated binding, previous digest, sequence, correction
attempt, monotonic time, inclusive 24-hour freshness, and terminal transitions, and returns immutable normalized
state. Findings and reasons are closed, unique, and sorted. Precedence and severity are rejected (3), manual-required
(2), correction-required (1), auto-review-candidate (0), with time then work identity tie-breaking.

Corrections have at most three attempts. Exhaustion becomes manual-required. Manual-required creates no authority;
a later explicit human-review boundary is required. Rejected is terminal for the same generation work identity.
A new GenerationJob with a distinct asset/version candidate is separate work and may be reviewed independently.

Durable queue items contain their complete bounded evidence chain, not only the head. The command parser independently
replays it and checks derived outcome/reasons/severity, scope-wide SKU/variant and job/asset anti-relabel, deterministic
order, freshness against command `asOf`, byte budget, canonical SHA-256, and `rqv1_` idempotency. Parsing snapshots all
caller data before asynchronous digests, closing mutation-driven TOCTOU. Limits are four chain events, 200 queue items,
16 findings per event, and 512 KiB per canonical command.

“Auto” means only `auto-review-candidate`. Every command fixes `operationalStatus=local-preparation-only`,
`g5Ready=false`, and explicit false values for QA approval, AssetVersion promotion, `recommendedForLive`, active
deployment, publication, and G1/G2/G5 evidence.

## Consequences

- Replay, duplicate identity, relabel, reorder, orphan head, stale/future evidence, post-terminal append, redigested
  status escalation, queue substitution, hostile structure, capacity excess, and async mutation fail closed.
- Local commands are reproducible and idempotent without granting human, control-plane, or delivery-plane authority.
- Authenticated upstream adapters, human review, persistence, SQL/Supabase/R2/network operation, publication, and
  production measurements remain future work.
- No physical product, image/device use, rights, actual-wear, operational evidence, or G1/G2/G5 passage is claimed.
