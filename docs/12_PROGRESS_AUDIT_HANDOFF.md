# Jessica progress audit handoff

## Audit baseline

This handoff freezes the implementation state for a high-level design audit.
The implementation baseline immediately before this document is
`f4bdfd9561efbb6be64faee91944029e0cd2bb17` on `main`. At that baseline the
working tree matched `origin/main`, and GitHub Actions run
[33344376004](https://github.com/ai-systems-tw/jessica/actions/runs/33344376004)
completed successfully for both `verify` and `postgres-17-acceptance`.

This is a repository/CI completion statement only. It is not a production
deployment, physical-frame verification, publication approval, or G1-G7 PASS.

## Implementation progress

### Runtime and browser foundations

- The camera-to-render runtime boundary, worker ownership, pose/scale/filtering,
  depth-only occlusion, projection, lifecycle cancellation, and camera-free
  browser self-test are implemented behind strict contracts.
- Public-live and QA-preview authority remain distinct. Generic QA-preview asset
  loading is deliberately zero-fetch closed; serialized objects cannot mint
  runtime, publication, deployment, or commerce authority.
- Existing public-live verified GLB bytes are loader-owned, copied on access, and
  bound to exact loader-created object identity.

### Evidence and control-plane progression

- The repository contains strict contracts and fail-closed evaluators for source
  inspection, dimension provenance, marking/formalization composition,
  calibration sessions, human QA decisions, GenerationJob history, AssetVersion
  projections, and quality evidence templates.
- JSC-0218/JSC-0218A add immutable non-Proxy human-review persistence, exact
  ES256 reconstruction, a least-privilege writer role, ambiguous commit recovery,
  and adversarial PGlite coverage.
- JSC-0219/JSC-0220 add authenticated committed-review capability rechecks, a
  pinned SELECT-only PostgreSQL reader, deterministic authority/candidate/job
  locking, database-clock expiry, and real PostgreSQL 17 acceptance.

### Authenticated one-shot QA-preview path

- JSC-0221 signs a short-lived ES256 transport grant bound to audience, actor,
  reviewer, session, selection, committed row digests, and time horizons.
- JSC-0221A1 defines bounded `JQAPB001` framing, URL-free runtime projection,
  exact manifest/model hashes and lengths, inert `./model.glb`, and a
  self-contained GLB profile with no external URI/extension surface.
- JSC-0221A2 implements one exact same-origin browser POST, a same-final-snapshot
  private artifact binding, strict private fetches, a bundle signer distinct from
  every transport key, signature-before-GLB verification, fixed no-store/
  same-origin headers, an identity-only one-shot browser handle, and an absolute
  request-through-runtime deadline.
- JSC-0221B implements permanent PostgreSQL replay tombstones, a forced-RLS
  credentialless claimer with exact column grants, private per-call 256-bit
  attempt identity, database-clock expiry, post-durability validation, and one
  bounded fresh-backend recovery after an ambiguous autocommit acknowledgement.
  A PostgreSQL service restart must preserve the tombstone and replay denial.

### Verification at the baseline

- Local full suite: 714 registered, 710 passed, 0 failed, 4 environment-gated
  PostgreSQL tests skipped in the ordinary lane.
- Focused durable-replay integration: 30 passed, 2 expected real-PostgreSQL
  skips outside the dedicated lane.
- Database authorization verification: v1 60 assertions, v3 170 assertions, v4
  46 assertions, and v5 59 assertions.
- Quality evidence template check passed with `expectedGateReady: false`; the
  canonical missing physical/device evidence remains rejected.
- `npm audit --omit=dev` reported zero vulnerabilities. Diff, secret, private
  media, token, and tracked-media checks were clean.
- GitHub Actions proved the ordinary suite plus PostgreSQL 17 multi-PID CAS,
  expiry wait, lost acknowledgement, backend termination/reconnect, role denial,
  and real database-container restart persistence.

## Current problems and open boundaries

### Production assembly is intentionally absent

- No deployed QA-preview endpoint or UI installs the library-level host/browser
  components. `main.ts` and the generic QA-preview loader remain closed.
- Production authentication, session/cookie handling, CSRF validation, CSP and
  origin policy, TLS, credentials, LOGIN-to-group-role membership, dedicated
  pool sizing/shutdown, authoritative-primary routing, migration execution,
  signer provisioning/rotation, monitoring, backup, and incident procedures are
  not configured.
- No remote Supabase migration or production control-plane write was performed.
  The repository has no real production row or availability observation.

### Permanent replay safety has an operational cost

- JSC-0221B intentionally provides no DELETE/janitor path. Deleting an expired
  tombstone without a proved monotonic-clock/rollback bound could make an old
  signed grant valid again after clock rollback.
- Permanent rows are the safe current decision, but production capacity,
  partitioning, backup, and any future retention policy need explicit review.

### Physical and visual evidence is still missing

- The available A3893 sunglasses material is private source material, not a
  complete J1-M package. It has not been admitted to the repository as verified
  same-specimen evidence.
- Physical caliper photographs are not yet available. There is no canonical
  six-view capture, required measurement provenance, three marking surfaces,
  actual-wear evidence, or five-device live-camera matrix.
- The physical frame has no temple engraving. Therefore a workflow that assumes
  an engraved identifier cannot be satisfied as written; absence itself must be
  represented as reviewed evidence or replaced by another approved specimen
  identity chain.
- G1, G2, AssetVersion publication, public-live deployment, commerce, and every
  physical/J1-M/G1-G7 PASS remain unclaimed.

### Documentation is cumulative

`PROJECT_STATE.md` preserves earlier slice-level statements such as “JSC-0221B
remains open” inside their historical sections. The later JSC-0221B section is
the current state. Auditors should distinguish chronological history from the
latest effective boundary rather than treating every older residual as current.

## Decisions required before further goal execution

1. **Choose the next completion definition.** Decide whether the next milestone
   is repository completion, a deployed private QA-preview, or physical J1-M/G1
   qualification. These require different authority, evidence, and risk.
2. **Select the production host topology.** Decide the hosting/runtime provider,
   Supabase project/environment, authoritative-primary connection path, identity
   provider, session/CSRF boundary, and ownership of secret/key provisioning.
   Repository code should not invent these production authorities.
3. **Approve the deployment security model.** Decide transport and bundle key
   custody/rotation, trusted key overlap windows, CSP/origin policy, endpoint
   routing, pool limits, shutdown behavior, monitoring, and incident response.
4. **Decide replay retention policy.** The recommended default is to retain
   permanent tombstones. Any deletion proposal must first prove the maximum
   signed horizon, clock rollback/skew bound, monotonic lower bound, backup/
   restore behavior, and a DB-enforced deletion authority that cannot remove a
   live row.
5. **Resolve marking-absent specimen identity.** Decide whether a formally
   reviewed `marking absent` result is acceptable, and which alternative facts
   bind the physical specimen across source capture, caliper session,
   formalization, generation, review, and actual-wear evidence. Do not fabricate
   a temple marking.
6. **Define the physical evidence acquisition plan.** Confirm the exact six
   source views, measurement list/method, required scale references, consented
   actual-wear matrix, five device/browser classes, and who signs/reviews each
   evidence family before resuming J1-M or G1.
7. **Approve the next ticket boundary.** If physical inputs remain unavailable,
   the next non-physical work should be limited to an explicitly selected
   production assembly/operations ticket. It should not silently open public
   loading or claim deployment from library tests.

## Recommended audit questions

- Does the one-POST host/browser design preserve the intended separation between
  browser request JSON and trusted authentication/session/CSRF context?
- Is every path to runtime authority backed by signature verification, durable
  replay consumption, a fresh committed-review snapshot, and a bounded time
  horizon without a structural-object bypass?
- Is permanent tombstone retention acceptable for the first production phase,
  or is a monotonic retention proof required before deployment?
- Which residuals belong in code, infrastructure-as-code, operator runbooks, or
  human evidence procedures?
- What exact evidence is sufficient to identify a specimen with no temple
  engraving while preserving the current anti-relabel and same-specimen rules?

Until these judgments are recorded, the correct state is to keep the goal
stopped at JSC-0221B and make no production or physical PASS claim.
