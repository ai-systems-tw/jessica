# ADR-0025: Local fail-closed external service readiness boundary

Status: Accepted for local preparation only

## Context

G6 requires tenant isolation, hosted embed onboarding requirements, exact origin/CSP/camera requirements,
privacy-safe usage metering, legal/IP review, sustained self-operation, and a service/support boundary. E1–E3
already define the WidgetProtocol, hosted iframe security, deployed catalog, and non-biometric commerce-event
boundaries, but the repository has no authenticated tenant authority, signed onboarding, production header
delivery, legal decision, real usage source, billing/pricing authority, or staffed support operation. A local
manifest or counter must not manufacture any of those external prerequisites.

## Decision

Add one strict `service-readiness.profile` schema v1 under policy `g6-local-v1`. Its canonical digest binds one
exact tenant/site/production scope, distinct exact parent and widget HTTPS origins, a canonical widget URL beneath
an exact path prefix, and exact catalog and asset HTTPS origins. Wildcards, credentials, HTTP, paths in origins,
queries, fragments, trailing slashes, suffix tricks, dot traversal, and cross-origin widget substitution fail
closed. Every URL/origin string is bounded to 2 KiB before URL parsing or hashing. The derived embed requirements
use the exported WidgetProtocol name/version and reproduce the candidate
parent/widget CSP, Permissions-Policy, iframe sandbox, and origin-scoped camera delegation from the E1 security
boundary. They explicitly require production response-header and live cross-browser verification.

Every external prerequisite is a closed key fixed to `pending-external`: authenticated tenant authority,
billing/pricing authority, sustained self-operation evidence, legal/IP review, production delivery headers, real
usage evidence, signed onboarding authority, and support staffing. The local service boundary is limited to embed
requirements review, protocol-fixture review, and usage-contract replay. Support SLA and escalation channel remain
null; no legal, service-plan, auth, pricing, or staffing policy is invented.

The bounded usage taxonomy contains only `widget-session-opened`, `try-on-started`, and
`catalog-selection-succeeded`. Each event is exactly one local unverified occurrence bound to the profile digest,
tenant/site/production, exact parent origin, strict sequence/time, and prior event digest. The maximum ledger is
256 events and 24 hours. Evaluation snapshots hostile input before its first digest await, verifies canonical
event hashes, rejects replay/relabel/reorder/sparse/orphan/cross-scope/future/stale input, and returns only a
deterministic non-billable summary. It contains no media, capture reference, landmark, pose, geometry, raw error,
medical/prescription, price, invoice, payment, or free-form field. The append helper evaluates the prior ledger at
the new event time and replays the resulting chain before returning it.

The canonical command embeds the complete ledger and independently re-evaluates all derived requirements,
summary, service boundary, freshness, and authority fields. It is bounded to 256 KiB and has deterministic SHA-256
and idempotency identity. Every evaluation/command fixes `operationalStatus=local-preparation-only`,
`g6Ready=false`, and denies tenant provisioning/activation, origin authorization, authenticated tenant authority,
billing, invoicing, pricing, publication, deployment, production headers, support SLA, legal approval, signed
onboarding, and G1/G2/G5/G6 evidence.

## Consequences

- The slice supplies a reviewable onboarding/readiness candidate and privacy-safe local meter replay without a
  production adapter, persistence, SQL/Supabase/R2, network, filesystem, or remote mutation.
- Runtime-frozen allowlists and strict plain-data parsing reject prototype/accessor/symbol/cycle/sparse/oversize
  input, async mutation, redigested status/authority escalation, and cross-tenant/site/origin substitution.
- A counter is not real usage, a digest is not tenant authorization, and candidate headers are not delivered
  production headers. Billing/pricing and invoices remain outside this boundary.
- Legal/IP review, sustained self-operation, authenticated tenant authority, production delivery/header evidence,
  signed onboarding, real usage, and staffed support remain external. G6 stays not active and not passed.
