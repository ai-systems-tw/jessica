# Jessica G1 Implementation Handoff

## Mission

Advance Jessica from `G0_FOUNDATION_ACTIVE` to `G1_SINGLE_FRAME_RUNTIME_PASS` without changing the high-level product boundary.

## Canonical order

1. `docs/01_HIGH_LEVEL_DESIGN.md`
2. `docs/02_DECOMPOSITION_DESIGN.md`
3. `docs/04_QUALITY_GATES.md`
4. `PROJECT_STATE.md`
5. ADRs

## Active vertical slice

```text
J1-M source/measurements
→ MediaPipe Face Landmarker adapter
→ PoseAdapter and CameraCalibration
→ ScaleResolver
→ ConfidenceGate and One Euro filters
→ depth-only facial mesh
→ Three.js eyewear render
→ first Ground Truth report
```

## Required implementation sequence

### Campaign 1 — Tracking adapter

- [x] Pin official `@mediapipe/tasks-vision@1.0.1`.
- [x] Self-host WASM and configure the task model path externally; no public CDN is hard-coded.
- [x] Implement `FaceTrackingBackend`.
- [x] Expose configured-resource and browser Resource Timing observations during initialization and detection.
- [x] Provide no-face, model-load-failure, disposal, timeout, monotonic timestamp, and restart tests.
- [x] Provision the reviewed task model with pinned SHA-256 and record a camera-free browser network trace.
- [ ] Record all canonical live-camera device classes: representative iPhone Safari, lower-end iPhone/SE, mid-range Android Chrome, Windows Chrome, and Windows Firefox.

### Campaign 2 — Pose/camera fixture

- [x] Freeze one canonical MediaPipe result fixture.
- [x] Implement coordinate conversion, mirroring, object-fit crop, aspect, and FOV mapping.
- [x] Keep scale estimation separate from orientation conversion.
- [x] Add center, edge-of-frame, mirror, projection-agreement, and invalid-depth tests.
- [x] Add iris observation, scale median/outlier rejection, bilateral downgrade, low-pixel handling, and manual override tests.

### Campaign 3 — Renderer

- [x] Pin `three@0.185.1` and self-host its browser modules.
- [x] Implement GLB loading and immutable attachment-matrix application; actual J1-M GLB remains pending.
- [x] Add device-pixel-ratio cap and resize/orientation handling.
- [x] Add dynamic depth-only face mesh before appearance work.
- [x] Keep lighting/material handling minimal until attachment is validated.
- [x] Wire the completed modules into the browser animation-frame lifecycle with fail-closed error handling.

### Campaign 4 — Quality evidence

- [x] Add fail-closed J1-M measurement/source/GLB readiness validation.
- [ ] Capture the real J1-M measurements and source photos.
- [x] Add consent-aware actual-wear Ground Truth annotation contracts and templates.
- [ ] Create the canonical 3 people × 5 frames × front/left/right actual-wear Ground Truth set.
- [x] Emit bridge, frame-width, lens-center, and roll errors through the quality harness.
- [ ] Record the canonical five-class live-device results without relabeling runs.

### Campaign 5 — Runtime resilience before physical evidence

- [x] Implement and test the pure runtime lifecycle reducer.
- [x] Emit bounded initialization, first-detection, first-render, detection, and render performance traces.
- [x] Test camera restart, permission-denied retry, stale request cancellation, track-ended shutdown, and in-flight initialization cancellation.
- [x] Test asset replacement failure and renderer-level WebGL context loss/restoration with fail-closed rendering.
- [x] Route application-level WebGL context loss through terminal coordinator teardown; require explicit restart.
- [x] Stop camera/tracking on page hide or background transition; require an explicit restart.
- [x] Add delivery headers for MIME sniffing, referrer leakage, camera permissions, and same-origin runtime assets.
- [x] Add `JSC-0216` application coordinator as the exclusive public-live owner of preflight, camera,
  runtime, RAF, visibility/pagehide, stable public errors, and serialized generation teardown.
- [x] Keep calibration SELF_TEST mutually exclusive with live controls and dispose it on page hide/destroy.
- [x] Cover denial/unsupported, hostile errors, init/tracking/RAF/context failures, track-ended,
  stop-during-pending, stale completion, reentrant start, callback exceptions, double stop/dispose,
  capability ABA, and restart-after-failure with injected deterministic ports.

JSC-0216 verification: typecheck, 43 focused runtime/lifecycle tests, all 541 deterministic
tests, intentionally-not-ready evidence-template check, diff/private/secret/media scans pass.
The parent-environment dependency audit (`npm audit --omit=dev`) reports zero vulnerabilities.
A parent Chrome smoke confirms missing signed Deployment configuration fails during preflight
with a closed public message and no console warning/error, before camera acquisition. The pinned-
fixture SELF_TEST reproduced the same Worker inference timeout on JSC-0216 and the `00a9f90`
baseline, so it is not recorded as a new browser tracking pass. External physical/device blockers
remain unchanged.

### Campaign 6 — Source and measurement evidence

- [x] Add unknown-input-safe SourceAsset, MeasurementSet, and FrameCaptureDraft validation.
- [x] Bind every required dimension to a source SHA-256, raw label, method, and verification state.
- [x] Inspect real local bytes for SHA-256, size, magic MIME, pixel dimensions, and path containment.
- [x] Keep private raw capture paths in local ENV and generate immutable private object keys without leaking absolute paths.
- [x] Accept a single annotated overview as an unverified draft while keeping G1 readiness false.
- [x] Add JSC-0205B fail-closed authoring from inspected sources with exactly five author-supplied measurements.
- [x] Derive hashes/object keys from actual bytes, force annotated-image evidence unverified, and omit file timestamps from the canonical authored draft.
- [x] Add `frame:capture:author` inspect → assemble → validate execution whose success means draft-valid, never G1-ready.
- [ ] Inspect the user-supplied candidate sunglasses image after it is attached or placed under the private source root.

### Campaign 7 — Runtime catalog and immutable asset trust

- [x] Replace the live hard-coded calibration asset with configured catalog URL/SKU selection.
- [x] Keep the calibration proxy as a draft, non-live, explicit self-test fixture only.
- [x] Pin manifest and GLB actual bytes with SHA-256 and byte length; reconcile identity and source hashes.
- [x] Validate GLB header/chunks, embedded BIN, metre bounds, POSITION bytes, bufferView containment, and required active-scene nodes.
- [x] Pass the exact verified GLB ArrayBuffer to the renderer without a second model fetch.
- [x] Apply the catalog origin allowlist consistently to catalog, manifest, model, and redirects.
- [x] Prove a second SKU can be added and selected through fixture data without runtime code changes.
- [x] Bind generic public-live catalog selection to an actual-byte-verified, signed active Deployment pointer with
  monotonic local receipt enforcement; this is local verification evidence only.
- [ ] Integrate that verifier with an authenticated production control-plane pointer, production keys, and tenant
  activation authority.

### Campaign 8 — Preemptible tracking Worker

- [x] Define a versioned, unknown-field-rejecting session/generation/request Worker protocol.
- [x] Move MediaPipe initialization and synchronous `detectForVideo` off the public-live UI thread.
- [x] Pin and actual-byte verify the same-origin model before SDK initialization; use a concrete Worker-resolvable vision module URL.
- [x] Enforce one-in-flight/latest-frame backpressure, transfer ownership, close-on-every-path, timeout termination, restart, monotonic timestamps, and stale suppression.
- [x] Keep the exact 250 ms UI visibility watchdog independent from the longer Worker inference timeout.
- [x] Add fake-Worker/protocol/packaging/origin regression coverage.
- [x] Rerun the camera-free real-browser self-test through the classic-bootstrap/ES-module Worker build: 478 landmarks, 3/3 results, zero Worker errors/external origins, and watchdog hidden.

### Campaign 9 — G2 design-assistance tooling (does not bypass G1)

- [x] Add strict exact-20 representative inventory identity, immutable-source, coverage, rights, and capture-readiness contracts.
- [x] Add a versioned capture-jig profile with exact front/±15°/±25° roles and separate spec-valid, physically-calibrated, and run-ready results.
- [x] Add strict Proxy/Standard/Premium run evidence and pure aggregate metrics/stop-signal evaluation; Commercial Reference remains optional.
- [x] Add fail-closed CLIs, synthetic/templates, tests, and operational protocols.
- [ ] Select 20 real distinct FrameModels, clear rights, and bind real source/measurement evidence.
- [ ] Build and physically calibrate the jig; replace every required-but-unset human calibration field with actual evidence.
- [ ] Execute and review all 43 internal cells (Proxy/Standard × 20 plus 3 difficult Premium baselines) and mobile device measurements before selecting a strategy.

### Campaign 10 — Wave C deterministic Proxy preparation (does not activate G2)

- [x] Extract runtime GLB actual-byte admission into one shared assets kernel.
- [x] Add strict versioned candidate/source/measurement/generator/manual-profile input validation.
- [x] Generate deterministic content-addressed metre GLB bytes with hole-aware rims, bridge, hinges, and temples.
- [x] Emit a runtime-compatible immutable manifest with fixed draft/proxy/non-live authority and explicit limitations.
- [x] Add a local-only CLI with explicit output containment and no-overwrite/collision behavior.
- [x] Add visibly synthetic fixture, deterministic/mutation/geometry/malformed/admission/CLI tests.
- [ ] Replace synthetic/manual inputs only through later real source, measurement, human review, physical QA, approval, and publication workflows.

This is an explicit-profile/parametric Proxy, not image-derived contour extraction.
It creates no product asset, J1-M evidence, contour-fidelity claim, physical
approval, G1 readiness, G2 ACTIVE/PASS, or live recommendation.

All committed G2 fixtures are visibly synthetic/templates and intentionally fail final readiness. G1 remains active and blocked on its existing real J1-M/actual-wear/device evidence.

### Campaign 11 — Wave D/D3 GenerationJob evidence boundary (does not activate G3)

- [x] Add strict versioned GenerationJob request/event contracts and deterministic processing identity/idempotency.
- [x] Add a pure allowed-transition reducer with bounded claim leases, ownership, expiry recovery, retry, cancellation, terminal immutability, and exact output evidence.
- [x] Make state replay-only from canonical hash-chained records with an explicit evaluation cutoff.
- [x] Add a local-only, symlink-safe, atomic, exact-idempotent immutable event ledger CLI.
- [x] Add visibly synthetic, non-promotable templates and deterministic contract/replay/filesystem/privacy tests.
- [x] Implement the local-only proxy-auto Processing Worker v0 with queued-input
  identity binding, atomic claim CAS, deterministic output, independent actual-
  byte verification, classified failure evidence, exact reuse, and review-only
  authority.
- [x] Close the private authored-input execution gap with a bounded no-follow
  private-root adapter, canonical deterministic generation, exclusive atomic
  `0600` file publication, sanitized hash/path-free receipts, and unchanged
  review-only non-promotable authority (ADR-0028).
- [x] Add the private ADR-0027-to-queued submission adapter so operators do not
  hand-author GenerationJob identities/events; keep processing as a separate
  Loop29 worker command (ADR-0029).
- [ ] Implement the D2 one-screen review workbench when rights-cleared source images, three rights-cleared test-face
  sets, and an authorized human approve/reject workflow are available; the strict local review boundary already
  exists, but a synthetic shell would not satisfy D2.
- [ ] Implement remote control plane/storage, approval/publication, and real Standard/Premium workflows in later
  bounded work.

This campaign records local processing evidence only. A Proxy output may enter
review but cannot become approved, published, deployed, or live through this
boundary. It does not claim G1, G2, or `G3_FACTORY_25_ASSETS_PASS`.

If a process stops between output and ledger commit, follow ADR-0011's exact
replay/lease-recovery procedure. Never delete or overwrite a pre-existing
content-addressed pair, and never infer a retry from an unclassified error.

### Campaign 12 — Local control plane and publication authority (non-promoting)

- [x] Create the migration with pinned Supabase CLI 2.113.0 command discovery and
  `migration new`; do not initialize, link, start, or contact a remote project.
- [x] Model tenant/site membership, FrameModel/FrameVariant/SKU, inspected source
  provenance and geometry, measurement evidence, generation identity/events,
  immutable AssetVersion bytes, QA decisions, authority identity, signed Deployment
  lineage, one current publication pointer, and append-only audit/publication events.
- [x] Keep authoritative rows/helper functions in unexposed `private`; expose only
  two `security_invoker` read views in `api` with underlying forced RLS, normalized
  membership checks, explicit least-privilege grants, and no `anon` access.
- [x] Enforce tenant FKs, hash/size/version/domain/status constraints, immutable URLs,
  append-only decisions/events, non-promotable Proxy assets, published asset
  immutability, exact-one stream pointer, and strict monotonic replacement/rollback.
- [x] Execute the production migration with PGlite 0.5.4 using test-only auth stubs;
  verify role-switched RLS isolation, constraint failures, policy/grant catalog, and
  activation/replacement/rollback evidence.
- [ ] Before any remote apply, create a dedicated Jessica project and complete the
  backup, dry run, advisors, Data API exposed-schema, hosted RLS, trusted mutation
  role, production signing-authority, immutable CDN, and incident-recovery review in
  `supabase/README.md`.

This campaign creates schema and synthetic ephemeral tests only. It creates no real
tenant/product/source/measurement/job/QA/approval/asset/publication/deployment/key/
actor/audit row, no remote project, and no gate evidence. G1 remains active/not
ready. G2 and G3 remain inactive.

### Campaign 13 — E1 Hosted Widget v1 local protocol/security slice

- [x] Export a strict WidgetProtocol v1 closed union from `packages/contracts` for
  init/open/close/SKU change and ready/opened/assetChanged/captureCreated/
  cartRequested/closed/error, plus only camera-permission and try-on-start lifecycle.
- [x] Reject unknown/malformed/prototype/accessor/cycle/non-finite/depth/size inputs,
  all nested biometric/media/geometry/raw-analytics aliases, bytes/blob/data URLs,
  unsafe error details, wrong bindings, replay/collision, and stale lifecycle.
- [x] Reserve valid bound inbound IDs before lifecycle/controller dispatch, expose and
  consume non-throwing safe parsers, bind exact command rollback/close reason, and
  fail closed without repeated side effects on response collision/transport failure.
- [x] Post best-effort terminal close during in-flight init/open teardown, keep queued
  replies terminal, prohibit post-terminal widget events, contain parent observers,
  and clean partial listener registration transactionally.
- [x] Add DOM-free parent iframe and reciprocal widget ports with exact HTTPS URL/
  path/origin/source/tenant/session/request checks, exact `targetOrigin`, minimal
  sandbox/camera delegation, protocol-only SKU changes, and deterministic disposal.
- [x] Add a camera-free transcript and candidate parent/widget CSP and
  Permissions-Policy ownership documentation covering frame/connect/worker/script/
  style/img sources. Do not report these candidate policies as production headers.
- [ ] Design and operate signed embed token/API-key/authentication, expiry/revocation,
  origin authorization, analytics backend, production delivery headers, real EC cart
  integration, and live browser camera/permission evidence.

This campaign is local tooling only. It creates no tenant authorization, remote
mutation, analytics record, live EC result, camera evidence, physical evidence,
publication/deployment, or gate promotion. See ADR-0017.

### Campaign 14 — E2 deployed catalog integration local boundary

- [x] Add strict schema-v1 request/event contracts with bounded commerce IDs,
  exact unknown-field rejection, closed fallback kinds, and closed unavailable reasons.
- [x] Add a pure exact-SKU/same-model fallback evaluator whose selected entry must
  match the verified active Deployment tenant/SKU/model/variant/asset binding.
- [x] Add a non-fatal privacy-safe unavailable sink with no raw errors, URLs, paths,
  stacks, secrets, or biometric/media/pose/scale fields.
- [x] Add one-key cancellable first-asset prefetch whose concurrent consumer reuses
  the same verified bytes without another catalog/manifest/GLB fetch.
- [x] Propagate abort, credentials omit/no-store/no-referrer, redirect-origin checks,
  body bounds, actual-byte hashes, GLB length, and immutable identity through the
  existing deployed loader.
- [x] Reject hostile nested catalog/manifest/envelope/Deployment records and arrays
  before getters execute; stream-bound/cancel the envelope without Content-Length.
- [x] Bind cached success to signed-expiry/host-age deadline, use semantic selection
  cache identity excluding requestId, re-correlate failures, and isolate consumer
  `REQUEST_CANCELLED` from shared prefetch cancellation.
- [x] Require non-empty exact canonical HTTPS deployment origins, deny credentials on
  all resource/redirect URLs, and cancel unread bodies on post-Response rejection.
- [ ] Gather real browser/CDN/network cancellation, redirect, performance, production
  telemetry, and self-EC commerce integration evidence.

This campaign adds local contracts, policy, adapters, and deterministic fake-port
tests only. It does not add a public-live authority path, alter a Deployment, mutate
production, operate telemetry, prove browser/network behavior, create physical
assets, or promote G1/G2/G3/G4. See ADR-0018.

### Campaign 15 — E3 commerce events local boundary

- [x] Add a strict schema-v1 closed commerce lifecycle union with bounded identity,
  timestamps/sequence, stable error classification, and immutable product attribution.
- [x] Exclude all camera/biometric/geometry/media/raw error/free-form properties and
  deliberately discard WidgetProtocol capture references from telemetry.
- [x] Add a pure reducer rejecting replay, reorder, impossible permission/start and
  capture/cart transitions, cross-binding/relabel, fatal continuation, and post-close events.
- [x] Add exact event/batch/byte/time budgets, deterministic batch idempotency,
  AbortSignal, closed retry/terminal classification, and exception isolation.
- [x] Bind idempotency to the full canonical batch projection, measure the exact final
  envelope, chain batches by SHA-256, and require cross-batch lifecycle evaluation before dispatch.
- [x] Treat sink responses and clocks as hostile boundaries and make nonrecoverable
  errors transition directly to terminal closed from every phase.
- [x] Derive production attribution only through the try-on-web registry backed by
  loader-private public-live `VerifiedRuntimeAsset` object-identity proofs.
- [x] Scope each production registry to exact bounded tenant/site/production identity
  across register/resolve/session creation and isolate identical SKUs across scopes.
- [x] Keep structural ledger state for pure replay, but require a module-issued opaque
  WeakMap-backed one-shot ledger for dispatch so forged prior lifecycle, concurrent
  reuse, and accepted-ledger replay cannot reach a sink.
- [x] Connect E1/E2 only through explicit ParentWidgetHost and catalog-unavailable
  adapters that re-parse input and cannot affect primary try-on/catalog/cart behavior.
- [x] Keep the Supabase control-plane migration unchanged and perform no remote mutation.
- [ ] Design and operate consent, authenticated ingestion, retention/deletion,
  tenant authorization, durable idempotency, production monitoring, and real commerce evidence.

This campaign is pure/local code plus fake-sink evidence. It is not production
telemetry, consent, analytics, commerce, browser/network, or gate evidence. G1/G2/G3/G4
remain unchanged. See ADR-0019.

### Campaign 16 — E4 static/low-vision UX local slice

- [x] Add a pure explicit low-vision capture reducer/controller with exact 3→2→1,
  generation-bound one-shot timer steps, one capture per countdown, and closed failures.
- [x] Add injected timer/audio/capture ports with AbortSignal cancellation, late-result
  disposal, hostile unknown-result validation, and receiver-safe local review capabilities.
- [x] Keep audio default-off and user-controlled; contain disabled/rejected cue playback
  without changing visual countdown or capture outcome.
- [x] Add local still review for users who put glasses back on, with retake, explicit terminal
  close, camera-loss/page-hide/destroy cleanup, modal focus/inert/Escape behavior, and no storage.
- [x] Add native large controls, live status/timer, labelled semantics, descriptive alt text,
  visible focus, contrast-safe tokens, text-not-color meaning, reduced motion, and forced colors.
- [x] Connect only through isolated E1 local-reference and argument-free E3 occurrence callbacks;
  exclude media, geometry, biometrics, capture reference, raw errors, and free-form telemetry from state.
- [x] Add deterministic timing/race/audio/disposal/privacy/E1/E3/accessibility-static tests.
- [ ] Gather real browser camera/compositor, keyboard/screen-reader/zoom/high-contrast,
  representative low-vision user, mobile device, and production lifecycle evidence.

This campaign is local preparation only. It is not an accessibility audit/certification,
physical asset or real-device evidence, production capture/telemetry/consent, existing-glasses
overlay support, remote mutation, or G1/G2/G3/G4 promotion. See ADR-0020.

### Campaign 17 — F1 demand queue local preparation

- [x] Add strict unknown-input v1 evidence, sales-rank, inventory-eligibility, shape-coverage,
  build, and canonical command contracts with bounded closed fields only.
- [x] Bind tenant/site/production and exact SKU/model/variant/shape or explicit unresolved
  candidate identity; reject cross-scope and scope-wide relabels.
- [x] Adapt only qualifying E2 catalog-unavailable events and E3 recoverable catalog/asset
  unavailable occurrences; deduplicate the same request across alternative adapters.
- [x] Separate metric validity, queue eligibility, and operational/G5 readiness; require fresh
  continuous in-stock inventory while rank/coverage missing or stale earns no invented bonus.
- [x] Freeze the documented inclusive windows and demand-dominant integer priority/tie policy.
- [x] Add 1,000 evidence/sample, 500 queue-item, and 512 KiB command budgets plus explicit capacity status.
- [x] Add deep command parsing, immutable normalization, canonical output digest/idempotency,
  strict write acknowledgement, and contained clock/read/build/write failures.
- [x] Add deterministic boundary, replay/reorder, identity, privacy, hostile input, score,
  capacity, parser-redigest, TOCTOU, and port-failure tests.
- [ ] Connect authoritative real sales/inventory and representative catalog sources; operate a
  production queue and measure real capture/generation/QA human effort.

This campaign adds no SQL, Supabase migration, remote mutation, physical assets, or production
operation. Output idempotency coalesces equivalent queue commands and is not authoritative source
evidence. G5 remains not active and every command is structurally `g5Ready:false`. See ADR-0021.

### Campaign 18 — F2 batch capture local preparation

- [x] Add a strict schema-v1 append-only batch event union and pure deterministic replay state machine.
- [x] Bind tenant/site/production/operator-session/batch/item and SKU/model/variant identities exactly.
- [x] Fix product type within each model and allow at most one `model-primary` variant tuple per model.
- [x] Require closed operator product-type and variant classification at item binding.
- [x] Keep raw bytes out of contracts/fixtures and accept only bounded opaque `localraw:` references.
- [x] Require an application-issued object-identity capability bound to batch/item/reference/expiry;
  consume it once without consuming it on failed substitution attempts.
- [x] Consume capability only after final replay/global-identity/budget validation succeeds; keep expiry in
  the same supported 2020–2100 inclusive range as event timestamps.
- [x] Make capture/capability/reference identities batch-global and prevent duplicate/relabel reuse.
- [x] Require per-capture quality; prohibit retake advance and retain accept/reject outcomes after completion.
- [x] Add exact retry idempotency, deterministic log SHA-256, deep snapshots, explicit budgets, and hostile
  unknown/prototype/accessor/cycle/sparse/oversize/replay/reorder/stale tests.
- [x] Keep completion `local-preparation-only` and `g5Ready:false`.
- [ ] Connect a real SKU scanner, private filesystem/camera adapter, authorized operator workflow, and
  operational measurements only after their external authority and storage lifecycle are designed.

This campaign performs no raw capture/upload, remote/public write, analytics emission, physical/rights/
actual-wear/device work, or gate promotion. F1 demand remains prioritization evidence only and cannot
authorize or double-count capture. See ADR-0022.

### Campaign 19 — F3 review operations local preparation

- [x] Add strict v1 work-item, hashed evidence, full-chain queue item, build, and canonical command contracts.
- [x] Bind tenant/site/production, SKU/model/variant, job/input/output, asset/version, policy, and candidate
  source/capture plus nullable F1/F2 digests exactly; reject all-zero external digests.
- [x] Label every upstream digest `candidate-references-unverified`; do not claim source-system verification.
- [x] Fix evidence to `evaluationAuthority=local-candidate-unverified`; keep evaluator labels/findings separate
  from authenticated human authority and runtime-freeze every exported finding/reason/outcome allowlist.
- [x] Derive only auto-review-candidate, correction-required, manual-required, or rejected using closed reasons,
  deterministic severity/order, inclusive freshness, and maximum-three correction attempts.
- [x] Make manual await explicit later human authority and rejection terminal for one generation work identity.
- [x] Embed and replay the entire bounded evidence chain in durable commands; reject orphan/reordered/tampered,
  stale/future, post-terminal, non-adjacent retry, redigested escalation, and queue substitution.
- [x] Deeply snapshot/freeze before async digest operations and test accessor/prototype/symbol/cycle/sparse/
  oversize/TOCTOU inputs plus local clock/read/write/acknowledgement failures.
- [x] Fix every command to `local-preparation-only`, `g5Ready:false`, and explicit false QA/promotion/live/
  deployment/publication/G1/G2/G5 authority.
- [ ] Add authenticated upstream GenerationJob/F1/F2/source evidence adapters, explicit human-review authority,
  and real production operations only after their external systems and authorization are designed.

This campaign includes no raw/media/path/URL payload, SQL/Supabase/R2/network/publication/remote mutation,
physical/image/device/rights/actual-wear claim, human QA authority, or G5 progress. See ADR-0023.

### Campaign 20 — F4 reprocessing local preparation

- [x] Add strict v1 request/event/ledger/plan/command contracts with a trusted contract-owned reducer.
- [x] Bind exact tenant/site/production, SKU/model/variant, old version/hash/job/review/QA, source/capture candidate,
  and new generation request/input identities; reject zero digests and authority relabels.
- [x] Stop regeneration at one unverified digest-reference attempt with no raw access or execution claim.
- [x] Require complete closed metrics for better/equivalent; route absent/partial evidence manual-required.
- [x] Bound canary to one exact SKU, partial traffic, finite duration, and later human/control-plane authority.
- [x] Bind rollback to the exact older unverified prior reference; prohibit roll-forward and automatic execution.
- [x] Embed/replay the entire chain in canonical commands and reject redigested plan/status/authority changes.
- [x] Freeze allowlists and reject duplicate/relabel/replay/reorder/stale/future/TOCTOU/hostile structures.
- [x] Fix output to `local-preparation-only`, `g5Ready:false`, and explicit false execution/QA/live/publication/gates.
- [ ] Add raw-material, authenticated provenance, generation, human QA, and control-plane authority only after those
  external systems and lifecycles are designed.

This campaign adds no raw store, SQL/Supabase/R2/network/filesystem/publication adapter and no physical, rights,
actual-wear, device, production, G1/G2/G5 evidence. See ADR-0024.

### Campaign 21 — G6 external service readiness local preparation

- [x] Add one strict versioned profile binding tenant/site/production and exact parent/widget/catalog/asset HTTPS
  origins plus a contained widget path/URL.
- [x] Derive WidgetProtocol identity from its canonical exports and generate the unchanged E1 candidate CSP,
  Permissions-Policy, iframe sandbox, and origin-scoped camera requirements.
- [x] Fix authenticated tenant, billing/pricing, continuous operation, legal/IP, production headers, real usage,
  signed onboarding, and support staffing to `pending-external`.
- [x] Add a frozen three-unit non-biometric usage taxonomy and bounded 256-event/24-hour hash ledger/summary.
- [x] Replay appended events and durable commands; reject replay/relabel/reorder/stale/future/cross-scope,
  hostile structures, async TOCTOU, and redigested result/authority escalation.
- [x] Fix every result to non-billable `local-preparation-only`, `g6Ready:false`, and explicit false tenant,
  origin, production, billing, legal, support, onboarding, publication/deployment, and G1/G2/G5/G6 authority.
- [ ] Add authenticated tenant authority, signed onboarding, actual response headers/browser evidence, legal/IP
  decision, real usage, pricing/billing, sustained operations, and staffed support only after external decisions.

This campaign has no production adapter, SQL/Supabase/R2/network/filesystem/remote mutation and does not activate or
pass G6. See ADR-0025.

### Campaign 22 — G7-A Fit Intelligence local preparation

- [x] Add strict product-candidate/input/evaluation/command v1 contracts binding exact tenant/site/production,
  SKU/model/variant, the existing five millimetre measurements, and immutable measurement/source/candidate digests.
- [x] Freeze one documented non-production candidate policy with fixed thresholds, integer weights, two-threshold
  eligibility, exhaustive relation/explanation codes, stable tuple/digest tie-breaking, and a top-five cap.
- [x] Reject cross-scope, duplicate/relabelled/reference-self, invalid/unverified, hostile structure, stale/future,
  redigested escalation, and async TOCTOU paths; route truthful unavailable/excluded states where defined.
- [x] Fix output to reference-product guidance, defer face-relative width for calibrated evidence, and hold outcome
  measurement `pending-external` without causal or purchase inference.
- [x] Deny recommendation publication, personalization, physical suitability/measurement, medical/biometric,
  source/catalog, mutation, analytics/remote, and G1/G2/G5/G6/G7 authority on every result.
- [ ] Validate product-size thresholds/weights, authenticate real measurement/source/catalog evidence, define
  privacy-safe outcome semantics and operations, and gather calibrated face/device evidence before any G7 claim.

This campaign has no photo/person fixture, production adapter, SQL/Supabase/R2/network/filesystem/analytics/catalog
mutation, or remote write and does not activate or pass G7. See ADR-0026.

## Prohibited shortcuts

- no 2D/2.5D alternate renderer;
- no server upload of camera frames or landmarks;
- no implicit mm-to-m conversion;
- no hidden per-product magic numbers outside `attachmentMatrix` and asset metadata;
- no claim of perfect fit or medical measurement;
- no remaining-500 capture before G2 strategy selection.

## Completion report format

```text
Canonical HEAD:
Gate:
Tests:
Device evidence:
J1-M asset version:
Placement metrics:
Known limitations:
External mutations:
Next blocking item:
```

### JSC-0213 marking inspection and source provenance

- [x] Preserve JSC-0212 actual artifacts and signed descriptors at
  `sourceRole:null`.
- [x] Add strict independent ES256 capture-provenance and marking-inspection
  contracts with host-only trust, clock, evidence age, and supersedes head.
- [x] Require one specimen, the exact candidate/source set, actual bytes, and
  distinct marking captures for left/right temple inner and bridge inner.
- [x] Separate reported absence from policy-derived absence and keep mixed/
  observed inspections on the required transcription route.
- [x] Keep all six verified-caliper dimensions, J1-M/G1 marking source, QA,
  AssetVersion, live, Deployment, publication, and gate requirements unchanged.
- [ ] Supply authorized signed provenance/inspection evidence for the private
  A3893_S9 photographs; current user facts alone do not satisfy this item.

See ADR-0032. No private photograph/archive or `.env` is committed.

### JSC-0214 caliper provenance and formalization composition

- [x] Re-evaluate the full JSC-0212 and JSC-0213 raw requests under host-only
  trust, clock, and lineage; reject cached caller readiness/results.
- [x] Verify strict canonical calibration-record and measurement-session actual
  bytes with bounded sizes, actual digests, dedicated kinds, and
  `sourceRole:null`.
- [x] Bind direct physical caliper provenance, all six canonical ordered `mm`
  observations, specimen/operator/time/caliper/calibration, candidate/job/source,
  MeasurementSet, and capture-provenance digest.
- [x] Require calibration and measurement to use independent tenant-scoped ES256
  authority/key/JWK fingerprints, while the measurement authority/key exactly
  matches JSC-0212 physical evidence.
- [x] Keep the output immutable and digest-only with QA, AssetVersion,
  recommended-live, Deployment, publication, and every gate false.
- [ ] Supply an authorized real calibration record and same-specimen physical
  measurement session; current repository coverage is synthetic only.

See ADR-0033. Authenticated human QA decision handling is the following JSC-0215 boundary.
No private A3893 photograph/archive or `.env` is committed.

### JSC-0215 authenticated non-Proxy human QA decision

- [x] Re-evaluate the complete raw JSC-0212/JSC-0213/JSC-0214 packages under
  host-only trust, time, and lineage and reject cached readiness/results.
- [x] Add strict canonical ES256 `approve | reject` evidence binding the exact
  candidate/job/model/variant/source/MeasurementSet/specimen, composed digests,
  validity horizon, closed issues, non-live envelope, and terminal times.
- [x] Bind reviewer attribution to the tenant-scoped host trust record and reject
  authority/key/fingerprint reuse or JWK aliases across every upstream trust root.
- [x] Derive `reviewReadyAt` from replayed raw job/earlier QA, formalization,
  marking/capture/inspection, calibration/observation, and attestation evidence.
- [x] Derive only an immutable approved non-Proxy review projection on approve;
  reject derives neither a projection nor QA approval.
- [x] Keep AssetVersion creation/promotion, live recommendation, Deployment,
  publication, database mutation, and all gates false on both paths.
- [ ] Supply an authorized real same-specimen evidence package and host-trusted
  human reviewer decision; repository evidence remains synthetic only.

See ADR-0034. No private A3893 photograph/archive or `.env` is committed.
Verification: typecheck, 16 focused JSC-0215 tests (plus 10 imported JSC-0214
regressions), all 517 tests, the intentionally-not-ready evidence-template check,
diff/private/secret/media scans and the parent-environment dependency audit
(`npm audit --omit=dev`, zero vulnerabilities) pass.
