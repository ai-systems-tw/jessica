# ADR-0034: Authenticated non-Proxy human QA decision

## Status

Accepted for JSC-0215.

## Context

JSC-0214 proves that formalization, marking/capture provenance, and calibrated
physical measurements form one bounded authorized-human-review input. It does
not authenticate a reviewer or grant QA approval. Accepting a cached readiness
result, a caller-selected reviewer identity, or a decision made before the last
prerequisite evidence would leave the application boundary open.

## Decision

Add a pure `evaluateNonProxyHumanQaDecision` boundary with the canonical
`approve | reject` terminal enum used by the QA contract and SQL model. The
request contains only the complete raw JSC-0214 request and one strict ES256 v1
decision attestation. The host supplies the complete JSC-0214 clock, trust, and
lineage context plus exactly one tenant/authority/scope/key/fingerprint/reviewer
trust record. Cached upstream results, clocks, trust, lineage, projections,
AssetVersions, or a caller-provided review-ready time are not request fields.

The evaluator synchronously snapshots all nested objects and bytes before its
first asynchronous operation, detects cycles, and then internally re-evaluates
JSC-0212, JSC-0213, and JSC-0214. The signed decision binds candidate/model/
variant/version, GenerationJob lineage and output, sorted source set,
MeasurementSet, specimen, every composed result and payload digest, the exact
upstream validity horizon, internal-review-only rights, reviewer, decision,
closed sorted issue categories, optional notes, optional approved envelope, and
review/issuance/expiry times.

Composed payload binding explicitly includes both calibration-attestation and
measurement-attestation payload digests. Re-signing unchanged record/session
bytes under altered valid issuance or authority provenance invalidates the prior
human decision.

The composed result identities are durable: canonical hashes exclude the host
`evaluatedAt` field while retaining stable evidence identities, payload digests,
authority denials, and validity heads. `evaluatedAt` remains host-only evaluator
input/output. One still-unexpired signed decision can therefore be reverified at
a later honest host clock without re-signing; its payload digest stays constant
and its effective validity remains the minimum real evidence/decision expiry.

The reviewer identity is host-selected: `reviewerId` is part of the trust record
and must equal the signed attribution. Reviewer authority ID, key ID, and the
recomputed exact host-JWK fingerprint must be independent from every
formalization, report, capture, inspection, calibration, and measurement trust
root. Reusing a key under a new ID or JWK alias fails closed.

`reviewReadyAt` is recomputed from successfully replayed raw prerequisites. It
includes GenerationJob creation/events, the earlier signed non-Proxy candidate
decision review/evaluation, formalization attestation issuance, marking report/
capture/inspection times, calibration readiness, measurement observation, and
calibration/measurement attestation issuance. Human `reviewedAt` cannot predate
that maximum; issuance cannot predate review, and host freshness, lifetime,
expiry, and composed validity bounds still apply. Effective `validUntil` is the
minimum of reviewer expiry, upstream input validity, and the exclusive
`reviewedAt + maximumReviewAgeMs` host freshness boundary.

Approve requires no issues and an envelope equal to or narrower than the
candidate: yaw/pitch cannot increase, the minimum scale-confidence rank cannot
decrease, and `recommendedForLive` remains false. It derives only an immutable
`approved-non-proxy-review-projection`, not a persisted AssetVersion. Reject
requires at least one issue and derives no projection or QA approval.

## Consequences

An approve result may set only review-scoped `qaApproved:true`. Both outcomes
keep AssetVersion creation/promotion, live recommendation, active Deployment,
publication, and all gates false. Rights remain `internal-review-only`; there is
no database, filesystem, network, catalog, deployment, or publication mutation.

Repository fixtures remain synthetic. No private A3893 bytes, `.env`, real
authorized reviewer decision, physical/G1/G2/G3 pass, AssetVersion, or
publication pass is claimed.
