# Jessica Project State

## Canonical identity

- Product name: `Jessica`
- Intended repository: `ai-systems-tw/jessica`
- Initial business scope: fashion glasses and sunglasses
- Architecture status: high-level design and decomposition design frozen for implementation
- Current gate: `G1_SINGLE_FRAME_RUNTIME_ACTIVE`

## Completed in the initial implementation slice

- Repository structure and source-of-truth documents
- Unit and asset contracts
- Tracking filter primitives
- Confidence/failure state machine
- Quality metrics and deterministic sample report
- Camera-permission browser shell
- Automated tests and CI workflow

## F3 Review Operations local preparation slice

- Added strict schema-v1 work-item, append-only evidence-chain, queue-build, queue-item, and canonical
  command contracts. Every record binds tenant/site/production, SKU/model/variant, GenerationJob and
  reviewed input/output candidates, asset/version candidate, `f3-local-v1`, and nonzero source/capture
  candidate digests. F1/F2 are accepted only as nullable digest candidates.
- Candidate digests are explicitly `candidate-references-unverified`: binding proves local integrity, not
  that a GenerationJob ledger, F1 command, F2 log, source system, or capture operation was authenticated.
- Evidence fixes `evaluationAuthority=local-candidate-unverified`; evaluator IDs/versions and findings are
  unauthenticated local candidate labels, never authenticated human review or source proof. Runtime parser
  allowlists are frozen, so consumers cannot extend accepted findings, reasons, or outcomes by mutation.
- Pure replay derives only `auto-review-candidate`, `correction-required`, `manual-required`, or `rejected`
  using closed sorted findings and deterministic severity/order. Auto-candidate grants no QA approval,
  AssetVersion promotion, live recommendation, deployment, publication, or G1/G2/G5 evidence.
- Corrections are limited to three attempts. Exhaustion routes to manual-required; manual requires later
  explicit human-review authority. Rejected evidence is terminal, while a new generation plus distinct
  asset/version candidate creates a new work identity.
- Durable queue items carry their complete bounded evidence chain. Command parsing replays that chain,
  verifies canonical hashes, binding, sequence, attempt, prior digest, time, freshness, terminal state,
  reasons, severity, and order, and rejects orphaned or freshly redigested status escalation.
- Exact evidence retry is accepted only adjacent to its original event. Unknown fields, accessors, symbols,
  custom prototypes, cycles, sparse/oversized arrays, duplicate/relabelled identities, stale/future/reordered
  evidence, queue substitution, and async TOCTOU mutation fail closed.
- Contracts contain no `localraw:` reference, raw bytes/path/URL/media, people/session/camera/biometric data,
  free-form notes, or commerce/analytics payload. The local application uses only injected read/write/clock
  ports and adds no SQL, Supabase, R2, network, publication, or remote mutation.
- Every command is `local-preparation-only`, `g5Ready:false`, and contains explicit false authority fields.
  No physical, image, device, rights, actual-wear, production-operation, or gate claim is created. See ADR-0023.
- Parent verification passes clean `npm ci`, typecheck, all 390 deterministic tests, the intentionally
  expected-false canonical evidence-template check, `git diff --check`, and online `npm audit` with
  0 vulnerabilities.

## F2 Batch Capture local preparation slice

- Added strict schema-v1 bounded batch events and a pure replay state machine for open, SKU/model/variant
  binding, private raw-reference recording, quality decision, item advance, and batch completion.
- Bound every event to tenant/site/production/operator-session/batch and monotonic sequence/time. SKU and
  item identities are batch-unique; variants cannot move across SKU/model identities. Multiple variants
  under one FrameModel remain intentional catalog behavior compatible with E2/F1, while product type is
  model-stable and at most one variant tuple per model may be classified `model-primary`.
- Added closed operator product/variant classifications and stable quality issue codes. Retake never
  advances; accept/reject are retained as distinct completed outcomes so completion is not approval.
- Added an application-owned WeakMap capability boundary for bounded `localraw:` references. Capability
  identity is not structurally forgeable, is exact batch/item/reference/expiry bound, consumes once only
  after final replay/budget validation succeeds, and allows exact-boundary use within the event timestamp's
  2020–2100 range. Capture/capability/reference identities are
  batch-global and cannot be reused or relabelled later.
- Raw camera/product bytes, paths, URLs, data URLs, public/widget/commerce/analytics fields, and raw
  errors do not enter the contract or fixtures. No camera, filesystem, raw upload, SQL, Supabase, R2,
  network, public publication, or analytics adapter was added.
- Added exact already-appended retry idempotency, deterministic log SHA-256, deep normalization/freezing,
  and explicit 100-item/1,000-event/1-MiB/16-issue budgets.
- Added focused adversarial tests for happy/retake/reject flows, replay/reorder/stale transitions,
  identity relabels, global capture authority, capability forgery/expiry/consumption/substitution,
  TOCTOU aliases, unknown/accessor/prototype/cycle/sparse/oversize inputs, and private-reference shape.
- Completion records only `local-preparation-only` and `g5Ready:false`. This creates no physical, rights,
  actual-wear, real device, production operations, G1, G2, or G5 evidence. See ADR-0022.
- Parent verification passes clean install, typecheck, all 377 tests, the expected-false canonical
  quality-evidence template check, diff checking, and online `npm audit` with 0 vulnerabilities.

## F1 Demand Queue local preparation slice

- Added strict v1 unavailable-demand, sales-rank, inventory-eligibility, frame-shape coverage,
  build, and command contracts. They contain only bounded tenant/site/product/candidate identities,
  closed enums/integers/timestamps, and no people/session/device/biometric/media/free-form fields.
- Added explicit E2 and E3 adapters. Only qualifying stable unavailable signals enter the core;
  shared request correlation makes the two adapters alternative evidence and prevents double count.
- Added scope-wide SKU/variant/candidate anti-relabel, replay/correlation deduplication, future/
  conflict rejection, and deterministic latest-snapshot selection.
- Frozen policy `f1-local-v1`: inclusive 30-day demand, 24-hour rank, 1-hour inventory, 7-day
  coverage; fresh continuous in-stock is required; missing/stale rank or coverage earns no bonus.
  Priority is `demand × 1000 + rank 0..100 + underrepresented shape 25`, then oldest demand and
  canonical identity, so demand remains dominant without a 100-count cap.
- Added 1,000 evidence/sample, 500 item, and 512 KiB command budgets. Canonical command parsing
  validates nested targets/reasons/score/window/order/uniqueness, returns a deep-frozen snapshot,
  and derives SHA-256/output idempotency. Equivalent operational outputs intentionally coalesce;
  the digest is not authoritative raw-source provenance.
- Added contained injected clock/read/write ports with exact accepted/idempotent acknowledgement.
  Hostile input/response, observer/port exception, cross-scope substitution, and score manipulation
  fail closed.
- Added 12 focused deterministic tests covering adapters, demand replay/reorder, window/freshness
  boundaries, no/unknown/stale stock, rank/coverage states, equal-score order, demand dominance,
  tenant/site and relabel isolation, hostile privacy inputs, redigested commands, TOCTOU, capacity,
  G5 false, and port failures. See ADR-0021.
- Verification: pinned `npm ci`, typecheck, 12/12 focused tests, 364/364 full deterministic tests,
  the intentionally gate-not-ready quality evidence template check, and `git diff --check` pass.
  Parent-environment online `npm audit` reports 0 vulnerabilities.
- No SQL, Supabase migration, remote write, or physical asset was added. This is local preparation;
  real sales/inventory, representative catalog, production queue/operations, human effort, physical
  assets, and G5 activation/passage remain external. Current gate stays `G1_SINGLE_FRAME_RUNTIME_ACTIVE`.

## E4 Static/Low-Vision UX local slice

- Added a DOM-free pure controller/reducer with explicit unavailable, ready, exact 3→2→1
  countdown, capturing, review, failed, paused, closed, and destroyed states. Timer callbacks
  are generation-bound and one-shot; duplicate, stale, synchronous reentrant, cancelled,
  hidden, and destroyed callbacks cannot create extra captures.
- Added injected AbortSignal capture, timer, and optional audio ports. Audio is default-off,
  explicitly user-controlled, and non-blocking when unavailable or rejected. Camera loss,
  cancellation, page hide, retake, terminal close, and destroy abort/dispose current and late results.
- Browser still composition is dimension-bounded and retains the temporary JPEG only behind a
  revocable local Blob object URL. No image bytes, landmarks, pose, biometrics, capture reference,
  raw error, or free-form telemetry enter public state serialization or external persistence/transmission.
- Added large native controls, labelled live regions/timer/dialog, inert modal background,
  focus entry/restoration, Escape terminal close, descriptive still review, visible focus,
  contrast-safe tokens, textual failure meaning, reduced motion, and forced-colors behavior.
- E1 receives only a validated bounded local opaque capture reference; E3 receives only an
  argument-free occurrence. Observer failures cannot change the local review outcome.
- Local evidence: pinned `npm ci`, typecheck/build, 18 focused deterministic/static tests,
  all 352 deterministic tests, the intentionally gate-not-ready quality template check, and
  clean tracked/untracked diff checks pass. Parent-environment online `npm audit` also reports
  0 vulnerabilities.
- Parent local-browser shell smoke confirms the labelled regions/buttons/status, large-control
  layout, audio toggle `aria-pressed` update with retained focus, and zero console warnings/errors.
  Camera permission was not requested; this is not camera/device/assistive-technology evidence.
- This is local preparation, not accessibility certification, assistive-technology/browser/device
  evidence, physical evidence, production capture/telemetry/consent, remote mutation, or a G1/G2/G3/G4
  claim. Existing-glasses overlay remains research-only and unimplemented. See ADR-0020.

## E1 Hosted Widget v1 local protocol/security slice

- Added strict fail-closed WidgetProtocol v1 contracts exported by
  `packages/contracts`: exact commands/events/payloads, bounded tenant/session/request
  correlation, closed lifecycle, unknown rejection, recursive structural limits,
  biometric/media/geometry/raw-analytics denial, local opaque capture references,
  and sanitized stable errors.
- Added reusable DOM-free parent iframe and reciprocal widget adapters with exact
  HTTPS origin/URL/path containment, never-wildcard target origins, minimal documented
  sandbox/camera delegation, source/origin/tenant/session/request binding, replay/
  collision/stale-state rejection, protocol-only SKU changes, and safe lifecycle.
- Added deterministic negative and happy-flow tests, a message-only camera-free
  fixture, ADR-0017, and candidate CSP/Permissions-Policy ownership documentation.
- Local evidence: `npm ci`, typecheck, 24 focused Widget tests, all 295 deterministic
  tests, the intentionally not-ready evidence-template check, diff validation, and
  `npm audit` all pass; the audit reports 0 vulnerabilities.
- Parent-audit hardening reserves bound inbound IDs before lifecycle/controller
  dispatch, adds non-throwing safe contract results, deterministic per-command
  recoverable rollback, exact close-reason binding, explicit spontaneous-error
  semantics, and non-throwing at-most-once bridge transport failure.
- Final parent-audit hardening adds reply-independent terminal close for in-flight
  init/open teardown, inert queued callbacks after destroy, post-terminal widget
  outbound denial, exception-contained parent observers, and transactional listener
  setup cleanup.
- Added the shared exact 256-message/session sent+received replay budget. Command
  paths reserve correlated-response capacity before effects; no old ID is evicted.
  Exhaustion clears pending work, closes locally with `MESSAGE_LIMIT`, emits no
  protocol echo, and makes later transport inert. Malformed/wrong-binding inputs do
  not consume the ledger. This is local memory protection only; no remote rate
  limiting or production abuse control is claimed.
- This is local tooling only. Signed embed token/API key/authentication, origin
  authorization, analytics backend, production headers/delivery, live EC/cart and
  camera-permission behavior, and physical/device evidence remain deferred. No remote
  service was mutated and no G1/G2/G3/G4 gate is promoted.

## E2 deployed catalog integration local boundary

- Added strict request and unavailable-event v1 contracts binding bounded commerce
  request/tenant/site/production/SKU/model/variant IDs and exact fallback policy.
- Added a pure evaluator: exact SKU never silently falls back; a missing SKU may use
  only an explicit same-model target that exactly matches the verified active
  Deployment tenant/SKU/model/variant/asset ID/version/manifest binding.
- Added a reusable deployed adapter and non-fatal privacy-safe sink. Invalid unknown
  input is rejected before network and is not logged; sink failure cannot change the
  primary closed result. Catalog recommendation/default metadata creates no authority.
- Added one-key cancellable first-asset prefetch. Same-key concurrent consumption
  shares the verified GLB bytes without a second catalog/manifest/model fetch.
- Hardened catalog, manifest, signed-envelope, and Deployment unknown records/arrays
  against getters, symbols, and custom prototypes before dereference. Envelope bytes
  now use a cancellable 256 KiB streaming bound even without Content-Length.
- Host deployment origins are now non-empty exact canonical HTTPS origins. Credentials
  are rejected on every deployment/catalog/manifest/model and redirect URL, and all
  post-Response status/origin/credential/declared-size failures cancel unread bodies.
- Deployment verification carries the minimum signed-expiry/host-maximum-age
  deadline. Cache use requires strict `now < deadline`; deadline/after refetches and
  reverifies without weakening monotonic receipts.
- Cache identity excludes requestId but includes all immutable selection/fallback
  semantics. Consumer failure is correlated to its own requestId, and consumer-local
  `REQUEST_CANCELLED` never aborts another consumer's shared prefetch.
- Every primary or same-key secondary prefetch handle owns the one shared speculative
  operation; any handle's explicit `cancel()` cancels it for all prefetch owners.
- Propagated abort plus credentials-omit/no-store/no-referrer/redirect policy and
  added 1 MiB catalog, 256 KiB manifest, and 32 MiB GLB response bounds while
  preserving existing actual hash/length/origin/shared-GLB validation.
- Added deterministic happy, fallback-negative, privacy, observer-failure,
  concurrency, cancellation, unknown-input, and byte-bound tests plus ADR-0018.
  Typecheck and all 321 deterministic tests pass; clean diff validation passes.
- This is local ports/fake-network evidence only. It makes no browser/CDN/network,
  telemetry, commerce, deployment, remote mutation, physical asset, or gate-promotion
  claim. Current G1 and physical G1/G2/G3 blockers are unchanged.

## E3 commerce events local boundary

- Added a strict schema-v1 unknown-input commerce event union for open, permission
  result, try-on start, product change, capture occurrence, cart request, close, and
  stable error classification. Every event binds tenant/site/environment/session,
  single-use event/request IDs, bounded timestamp/sequence, and immutable product-chain
  attribution where required.
- Camera frames/images, landmarks, pose/scale/biometrics, capture bytes/URLs/references,
  secrets, paths/stacks, arbitrary error text, and free-form analytics properties are
  absent from the contract. Widget capture references are deliberately discarded;
  only capture occurrence is recorded.
- Added a pure lifecycle reducer rejecting replay, reorder, cross-binding, impossible
  permission/start/capture/cart transitions, implicit product relabel, fatal
  continuation, and post-close events.
- Added exact 8,192-byte event, 32-event/32,768-byte final canonical batch,
  256-event/four-hour session,
  and 5,000 ms dispatch budgets; deterministic batch idempotency; AbortSignal; closed
  retry/terminal classification; and exception isolation.
- Parent-audit hardening binds `batchSha256` and `ceb1_<digest>` idempotency to the full
  canonical projection, includes envelope metadata in `byteLength`, and chains batches
  with `priorBatchSha256`. A required ledger evaluator replays every event before sink
  dispatch and advances only on acceptance.
- Sink results now reject getters/custom prototypes/symbols/unknown fields without
  dereference; timeout setup/cleanup failures cannot escape. Nonrecoverable errors
  transition directly to terminal closed from created/open/active states.
- Production attribution now comes only from a try-on-web registry backed by the
  public-live loader's private exact-object proof. Structural clones, QA/calibration,
  unregistered, or mismatched assets cannot self-authorize; the arbitrary resolver is
  explicitly local/test-only.
- Final parent-audit hardening scopes every production registry to one bounded exact
  tenant/site/production identity. Proof registration, resolution, and session creation
  reject cross-tenant/site/staging use; identical SKUs remain isolated by registry.
- Pure batch replay retains structural state, while public dispatch now requires a
  module-issued private-WeakMap opaque ledger. A plain forged active/cross-session state
  cannot use a correct prior digest to authorize cart-before-open or reach the sink.
  Parent final audit additionally made each ledger a one-shot capability: concurrent
  dispatch and reuse after acceptance are rejected locally, while retryable failures
  release the same ledger without advancing it.
- Added explicit ParentWidgetHost observer and DeployedCatalogIntegration unavailable-
  sink adapters. They re-parse inputs, avoid WidgetProtocol double counting, strip raw
  protocol/catalog error detail, and cannot affect primary try-on/catalog/cart behavior.
- No SQL or remote mutation was added. The Supabase control plane, G1/G2/G3/G4 status,
  and physical blockers are unchanged. Local/fake sink results are not production
  telemetry, consent, analytics, commerce, browser/network, or gate evidence.
- Automated evidence: clean `npm ci`, typecheck, all 334 deterministic tests,
  fail-closed canonical evidence-template check, zero-package-vulnerability audit,
  and clean diff validation pass.

## Completed G1 implementation slices

### `JSC-0201` MediaPipe Face Landmarker adapter

- Pinned `@mediapipe/tasks-vision@1.0.1`.
- Added a replaceable `FaceTrackingBackend` implementation with externally configured WASM and model paths.
- Build output self-hosts the pinned MediaPipe WASM files; the reviewed task model must be provisioned separately.
- Added initialization timeout, no-face handling, strict timestamp ordering, 4x4 matrix validation, network observation hooks, disposal, and clean reinitialization.
- Added deterministic adapter tests using an injected MediaPipe factory; live model/device evidence remains part of G1.

### `JSC-0202` Pose/camera adapter and `JSC-0202B` scale resolver

- Added deterministic column-major MediaPipe transform conversion into Jessica/Three.js camera space.
- Added selfie mirroring, `cover`/`contain` viewport mapping, vertical-FOV unprojection, canonical cm-to-m conversion, and configurable nose-bridge anchoring.
- Added MediaPipe iris pixel observations, bilateral consistency checks, rolling median, outlier rejection, low-pixel confidence downgrade, and explicit manual scale override.
- Added a frozen canonical pose fixture plus center, edge, mirror, crop, camera agreement, and scale-confidence tests.

### `JSC-0203` Three.js renderer shell and `JSC-0204` depth occlusion

- Pinned `three@0.185.1` and self-hosted the browser module plus the GLTF loader dependency graph.
- Added transparent WebGL scene lifecycle, GLB loading, immutable attachment-matrix application, camera near/far checks, lighting, DPR cap, resize observation, and deterministic disposal.
- Added pose/opacity application, physical scale correction with safety bounds, and fail-closed visibility.
- Added a dynamic depth-only facial mesh using validated MediaPipe tessellation triangles and per-frame viewport/depth mapping.

### G1 web vertical-slice integration

- Wired camera → MediaPipe → pose → iris scale → confidence gate → One Euro filters → depth mesh → GLB renderer in `try-on-web`.
- Added deterministic build-time calibration-proxy GLB generation; it is explicitly not J1-M and is not recommended for live product use.
- Added SHA-256-pinned provisioning for the official Face Landmarker model and official portrait fixture.
- Added a camera-free browser self-test. Local evidence: 478 landmarks, tracking state, high scale confidence, visible calibration GLB, and zero external runtime requests.
- Fixed browser packaging boundaries for shared compiled packages, `.mjs` MIME, and the complete Three.js module graph.

### `JSC-0205` / `JSC-0206` external-input tooling

- Added a fail-closed J1-M intake contract for measurements, six required source views, SHA-256 provenance, approved immutable GLB metadata, attachment matrix, and live QualityEnvelope.
- Added actual-wear placement annotation contracts with pseudonymous subject ID, source-image hash, consent reference, actual/rendered landmarks, jitter, tracking success, and FPS.
- Added deterministic bridge, width, lens-center, roll, and quality-gate report derivation plus CLIs.
- The committed templates intentionally report `ready: false`; no J1-M values or human evidence have been fabricated.

### G1 reliability and operational hardening

- Added the pure `RuntimeLifecycle` reducer for camera, model, tracking, denial, unsupported, and error transitions.
- Added constant-memory runtime performance traces for initialization, first detection/render, and aggregate detection/render duration.
- Made camera start/restart/stop generation-safe: stale permission results cannot reactivate a stopped session, old tracks are released, ended tracks fail closed, and denied sessions can retry.
- Added background/page-hide camera shutdown and in-flight runtime initialization cancellation.
- Added WebGL context loss/restoration handling and preserved the current GLB when a replacement asset fails to load.
- Added `nosniff`, referrer, camera permissions, and same-origin resource delivery headers to the local delivery boundary.
- Re-ran the camera-free browser self-test with performance evidence after hardening; the physical/device limitations are unchanged.

### G1 source acquisition boundary

- Added fail-closed `SourceAsset`, `MeasurementSet`, dimensional evidence, and `FrameCaptureDraft` contracts for unknown JSON input.
- Added real-file inspection for SHA-256, byte length, magic-byte MIME, JPEG/PNG dimensions, local path containment, and immutable private object keys.
- Separated a valid single annotated-image draft from G1 capture readiness. G1 still requires six distinct source roles and verified evidence for all five required dimensions.
- Added private-source ENV convention and intentionally incomplete candidate templates. Raw product photographs remain outside Git and public runtime delivery.
- Completed `JSC-0205B`: a strict authoring contract accepts exactly the five required field/source/value/raw-label records plus optional bounded regions, while rejecting author-supplied provenance and verification claims.
- Added pure inspected-source assembly and `frame:capture:author`; actual source bytes determine SHA-256/object keys, every image transcription is unverified, canonical draft output excludes mtimes, and command success is draft validity rather than G1 readiness.
- Added optional `--output-path` local-private draft persistence gated on an explicitly configured existing private root. Canonical `0600` bytes publish through an exclusive temporary file and atomic no-clobber hard link, then are no-follow reread for the receipt's actual SHA-256/length; unsafe paths, symlink/non-directory parents and targets, collisions, and invalid roots fail closed with sanitized machine output. Stdout-only behavior remains compatible, while one-image output success still reports `g1Ready:false` and grants no verification, rights, promotion, publication, or G1/G2/G3 authority.
- Added source-pixel coordinate provenance: JPEG/PNG/WebP EXIF orientation and JPEG/PNG/VP8X/VP8/VP8L encoded geometry derive only from bounded actual-byte parsing. Stable drafts preserve encoded/display geometry and raw-encoded half-open integer semantics while omitting mtime. Orientation 2–8 and legacy geometry-less regions/manual traces fail closed; raw-label-only legacy data is the sole compatibility case. Capture-to-Proxy digests and strict durable bodies bind the referenced geometry. This proves coordinate interpretation, not transcription correctness, OCR, contour fidelity, physical accuracy, rights, product identity, or J1-M/G1/G2/G3 authority (ADR-0015).
- Automated evidence for this boundary: typecheck, 42 focused source/capture/Proxy tests, all 270 deterministic tests, the intentionally gate-not-ready quality template check, and clean diff validation pass.
- Proved with a generated temporary PNG that a valid annotated-overview candidate exits successfully while retaining actionable `g1Ready: false` blockers. The user's described private image remains undiscovered and has not been ingested or verified.

### `JSC-0207` external runtime catalog and GLB integrity

- Removed the hard-coded calibration asset from the live try-on path. Live startup now requires a configured catalog URL and optional SKU; adding another product is catalog data, not a TypeScript/HTML change.
- Kept the deterministic calibration proxy only in an explicit self-test catalog. The live path rejects fixtures and accepts only `published` assets whose QualityEnvelope is recommended for live use.
- Added fail-closed unknown JSON catalog/manifest parsing and a pinned trust chain over manifest actual bytes, GLB actual bytes, identity, source hashes, metre units, bounds, and required nodes.
- Added GLB v2 header/chunk, embedded BIN, accessor/bufferView, finite POSITION actual-byte bounds, active-scene reachability, and catalog frame-width checks.
- Removed verification/load TOCTOU by passing the exact verified ArrayBuffer to GLTFLoader instead of fetching the model URL again.
- Applied one origin allowlist to catalog, manifest, model, and redirects. Active Deployment proof remains a later control-plane boundary.
- Added positive published-asset and code-free second-product fixtures plus integrity/origin/status negative tests.

### `JSC-0208` deterministic tracking quality and runtime policy

- Replaced MediaPipe face-present confidence 1/0 with a pure deterministic estimator over canonical landmark completeness/finite values, in-frame ratio, pixel span, normalized temporal residual, and transform rotation/translation jump. Landmark visibility is diagnostic input only and does not affect confidence.
- Corrected ConfidenceGate to retain the first below-exit instant. Fake-clock regressions prove no-face and moderate-low opacity is nonzero at 249 ms and zero at 250 ms, while short dips, exit recovery, enter/reacquire hold, and hysteresis remain explicit.
- Added a generation/visibility-lease-safe SingleFrameRuntime watchdog for missing frames and asynchronously pending detection. Dispose hides synchronously, stale timers/results cannot render into restarted sessions, and only healthy visibility refreshes the lease.
- Added normalized quaternion YXZ head-angle extraction and raw-pose QualityEnvelope evaluation. Yaw/pitch, minimum-required scale confidence, and millimetres-per-pixel availability fail closed on the same frame before filtering.
- Added `public-live`, `qa-preview`, and `calibration` asset admission. Rejected public/QA assets stop before manifest/GLB model fetch where catalog metadata is sufficient, and all rejected assets stop before backend/WebGL initialization. JSC-0207 verified bytes remain the only renderer input.
- Runtime View now exposes deterministic reasons, raw YXZ angles, and asset quality tier; the renderer remains policy-free and applies final opacity faithfully.
- Automated evidence: typecheck and 106 deterministic tests. A parent-environment post-JSC-0208 browser rerun passed with 478 landmarks, tracking, medium scale confidence, runtime angle/tier diagnostics, zero external-origin requests, and watchdog `lost` / opacity `0` after frames stopped. Provisioned model/portrait files remain intentionally uncommitted.

### JSC-0209 Ground Truth evidence gate

- Added versioned, unknown-field-rejecting Ground Truth evidence contracts with pseudonymous tenant/subject/fixture identities; frame/variant/AssetVersion binding; actual asset/source/manifest/model/capture/render/trace hashes; actual-bytes verification metadata; runtime commit/config; deterministic consent retention; image/view/device metadata; in-image annotations; and matching provenance.
- Added view-aware placement metrics, normalized roll, yaw attachment, circular temporal jitter, motion lag, reacquire jump, lost latency, and mandatory non-vacuous motion/loss/reacquisition coverage. Per-fixture violations cannot hide behind medians.
- Added explicit `technical-single-frame-slice` tooling readiness and strict `canonical-validation` promotion profiles. Canonical requires exact 45 cells, five unique device classes, full visual review, 3/10-minute sustained performance checkpoints, and operational scenarios. `metricPass`, `gateReady`, and `canonicalPromotionReady` are separate.
- Added machine-readable CLI/reporting and an intentionally rejected canonical authoring template. Raw actual-wear media remains outside Git.
- ADR-0007 resolves the J1-M single-slice/canonical coverage, device, and visual enum conflicts without shrinking the stricter source requirements.
- No physical evidence was fabricated. JSC-0209 tooling completion does not change `G1_SINGLE_FRAME_RUNTIME_ACTIVE`; canonical `gateReady` remains false until actual J1-M, consented 45-cell, and live-device evidence is supplied.
- Automated evidence: typecheck, 125 deterministic tests, fail-closed canonical template check, and clean diff check pass.
- The watchdog guarantee assumes browser event-loop progress. Synchronous main-thread MediaPipe blocking cannot be preempted by a timer and requires the later Worker boundary for an absolute wall-clock guarantee.

### JSC-0210 signed active Deployment proof

- Added a versioned fail-closed Deployment payload contract for tenant/site/environment, exact one active selector, SKU/model/variant, immutable AssetVersion, revision/generation, activation/audit provenance, catalog/manifest/model hashes, HTTPS allowed origin, and prior deployment digest/receipt chain.
- Added a pure evaluator for document time/order, host minimum floors and maximum age/lifetime, document-wide active stream uniqueness, strict revision+generation advancement, idempotent exact-document reload, rollback-safe prior receipt matching, and host catalog-origin intersection.
- Public-live now has one application entry point. The generic catalog loader rejects public-live even when given a deployment-shaped plain object. The application verifies a bounded ES256 envelope with an immutable host `keyId → authorityId + P-256 public JWK` mapping before parsing exact payload bytes.
- Query parameters may select only an allowlisted deployment URL. They cannot select the trust key/hash, catalog, or SKU. The verified pointer binds catalog actual bytes through manifest and GLB actual bytes; each is fetched once and the renderer receives the exact verified GLB ArrayBuffer.
- Public-live requires a Web Locks-serialized localStorage receipt store with re-read compare-and-set. The scope key is an unambiguous JSON tenant/site/environment tuple; commit conflict prevents the loader from returning an asset. QA preview and calibration retain explicit separate paths.
- Production deployment/catalog origins require HTTPS. Safari 15.4 is the local-authority public-live minimum; Safari Lockdown Mode disables Web Locks and therefore fails closed without a silent fallback.
- Deterministic tests use a fixed, explicitly test-only/non-production P-256 identity. No production key, signature, deployment event, authority, or activation evidence was created.
- Automated evidence: typecheck and 143 deterministic tests pass. This proves tooling/integrity readiness only. A new browser remains bounded by host floors plus signed expiry/maximum age/lifetime; absolute replay prevention requires an external online freshness authority and is not claimed.
- A parent-environment camera-free browser rerun passed with the locally reused official model/portrait bytes whose hashes match the repository pins: 478 landmarks, tracking, medium scale confidence, proxy-tier diagnostics, zero external-origin requests, and watchdog `lost` / opacity `0`. The child sandbox's localhost restriction was environmental and is not recorded as a product failure; the ignored model/portrait bytes remain uncommitted.

### Tracking Worker boundary

- Added `jessica.tracking-worker` protocol v1 with fail-closed exact-field parsing for init/frame/result/no-face/error/dispose, session/generation/request IDs, strict integer-microsecond timestamps, resource pins, transfer contract, and bounded diagnostics.
- Public-live now constructs only a Worker tracking backend. A minimal same-origin classic bootstrap preserves MediaPipe Tasks Vision 1.0.1 `importScripts` WASM-loader compatibility, buffers the init message until the Jessica ES-module graph is ready, and keeps MediaPipe initialization plus synchronous `detectForVideo` inside the Worker. Missing Worker or `createImageBitmap` support fails closed without an in-process fallback.
- Avoided reliance on document import maps by dynamically importing an explicit same-origin self-hosted MediaPipe module URL. The Worker fetches the pinned model once without credentials/cache, bounds the stream by exact Content-Length/byte length, verifies final redirect origin and actual SHA-256, and initializes from the verified buffer.
- Enforced one inference in flight plus one latest queued frame, deterministic drop counters, timestamp-order preservation even when bitmap creation completes out of order, complete plain-result validation, generation/result ordering, and stale suppression.
- Defined exact transfer ownership and close/release behavior for success, no-face, malformed input/result, post failure, detection error, timeout, queued drop, dispose, crash, and restart. Hung inference is terminable; restart creates a new generation.
- The independent UI visibility lease still hides at exactly 250 ms while Worker inference is pending and rejects late results. This assumes UI event-loop progress; another same-thread timer still cannot absolutely preempt a UI event-loop stall.
- Automated evidence: typecheck and 162 tests pass, including protocol/fake-Worker/packaging/origin coverage. A parent-environment camera-free real-browser rerun passed with the independently reverified ignored model/portrait bytes: 478 landmarks, 3/3 Worker frames/results, scale medium, Worker errors 0, external origins 0, runtime opacity 1, then watchdog `lost` / opacity `0`. No physical/device, J1-M, or G1 PASS is claimed.

### `JSC-0301`–`JSC-0303` G2 design-assistance boundary

- Added a versioned, unknown-field-rejecting representative inventory contract for one tenant and exactly 20 distinct FrameModels with explicit variants, cross-tenant/anti-relabel identity/source rules, commercial rationale, traits, rights, source/measurement readiness, and immutable source provenance. The pure coverage evaluator allows honest overlap across all nine roadmap traits while keeping representativeness, rights, capture readiness, synthetic status, and final selection separate.
- Added a versioned capture-jig contract for jig/camera profile, exact front/±15°/±25° roles, lighting/background, scale marker, caliper/angle gauge, naming, actual calibration hash/bytes/provenance, checklist, and replay metadata. Specification validity, physical calibration, and run readiness are separate; unsupported physical tolerances remain explicit nulls for human calibration.
- Added strict Proxy/Standard and three-model Premium baseline evidence plus optional Commercial Reference, single-tenant binding, same-input comparison integrity, unique input/output/model/render artifacts, post-run human review, supported-mobile performance, and size/correction/approval/failure evidence. Document validity, 43-cell completeness, inclusive metrics, strict stop signals, and G2 strategy-selection readiness are separate.
- Added fail-closed CLIs, operational protocols, comprehensive deterministic boundary tests, and committed `fixtures/g2/` inputs that are exclusively synthetic/templates.
- Automated evidence: typecheck and all 193 tests pass. The default inventory, jig, and bakeoff checks each exit 1 with structured fail-closed reports; malformed/missing inputs exit 2 with sanitized JSON and no path/stack disclosure; clean diff validation passes.
- This prepares tooling only. No real representative products, rights, physical jig calibration, manual baseline, commercial comparison, mobile measurement, or human review was created. `G2_GENERATION_STRATEGY_SELECTED` is neither ACTIVE nor PASS, and current gate remains `G1_SINGLE_FRAME_RUNTIME_ACTIVE` with unchanged external blockers.

### Wave C deterministic explicit-profile Proxy boundary

- Moved the GLB v2/header/chunk/embedded-buffer/accessor/active-scene/actual-POSITION/metre-bounds checks from the web loader into `packages/assets`; runtime catalog and generation now use the exact same validator.
- Added `packages/frame-generation` strict schema v1 parsing for candidate identity, sorted immutable source hashes, measurement identity and six required mm dimensions, generator identity/version/config digest, paired outer/inner lens polygons, bridge anchors, and hinge anchors.
- Added deterministic hole-aware front rims, bridge, and left/right temple GLB generation. The only mm-to-metre conversion occurs at geometry construction; generated actual bounds are checked against frame width and temple length.
- Added content-addressed GLB/manifest output carrying canonical input, measurement/source/generator/output provenance, actual bounds, required nodes, limitations, and fixed `draft` / `proxy` / `recommendedForLive: false` / calibration-only authority.
- Added an explicit-local-output CLI that refuses overwrite/collision and sanitizes errors, plus a visibly synthetic template and focused deterministic/fail-closed/runtime-compatibility tests.
- Parent integration hardening made GLB Float32 serialization explicitly little-endian, added strict connector-safe outer/inner point ordering, sanitized untrusted validation paths from CLI output, and made partial-write cleanup cover both files created by one invocation.
- Shared GLB bounds now derive only from active-scene reachable meshes while all declared geometry remains structurally checked; non-triangle modes and decoded out-of-range indices fail closed.
- Final shared-kernel hardening rejects matrix/TRS on reachable mesh nodes and mesh-affecting ancestors while preserving validated transform-only anchor leaves. Indexed and non-indexed triangle element counts must be divisible by three, closing render/bounds and incomplete-triangle bypasses.
- Automated evidence: typecheck and all 210 tests pass, including focused generator/CLI/shared-kernel/runtime-catalog regressions. The canonical promotion template remains fail-closed and `git diff --check` passes.
- This is explicit-profile/parametric Proxy preparation only. No image was found or processed; no bytes, OCR, dimensions, masks, or provenance were invented. No product/J1-M asset, contour fidelity, physical approval, G1 readiness, G2 ACTIVE/PASS, Cloudflare mutation, QA-preview, or public-live claim is made.

### Capture-draft to Proxy authoring provenance bridge

- Added a pure schema-v1 fail-closed bridge from strict `FrameCaptureDraft` to
  the existing deterministic Proxy generator input. Tenant/model and sorted
  source hashes derive only from the validated draft; callers supply only
  variant/asset candidate identity, generator identity/config, thickness
  provenance, and explicit profile authoring.
- Closed the five-to-six dimension gap without a default. Thickness is either
  source/raw-label/half-open-integer-region-bound unverified image/marking
  evidence or an explicitly non-physical assumption with reason, bounds, and
  limitations. Caller-asserted caliper/verified escalation is rejected pending
  a separate trusted verification artifact.
- Added deterministic no-contour-fidelity dimension-template authoring and
  source-SHA/region/integer-pixel/coordinate-rule-bound manual trace authoring.
  Unbound millimetre polygons fail closed; generated polygons still pass the
  existing strict correspondence/anchor/dimension checks.
- Bridge-authored legacy-compatible Proxy v1 inputs carry strict durable
  `authoringEvidence`. Complete thickness provenance and discriminated
  template/manual-trace bodies are canonical-input/GenerationJob-bound and
  copied into the manifest. The generator recomputes profile evidence digest and
  derived mm geometry; assumption limitations remain visible in the manifest.
- Required measurement and evidenced-thickness labels must contain an ASCII
  numeric token equal to their `valueMm`; decimal and composite marking syntax
  is covered without making any OCR or image-interpretation claim.
- Added ADR-0013 and a visibly synthetic/non-product fixture. No machine CLI was
  added because existing capture, job-ledger, and Worker adapters already own
  the durable filesystem execution boundaries.
- Automated evidence: typecheck, focused capture/generator/job/Worker/QA/runtime
  suites, all 256 deterministic tests, `quality:evidence:template-check`, and
  clean diff validation pass.
- The prepared non-J1-M dimension-annotated sunglasses image was not accessible
  in this worktree. No image bytes, source hashes, measurements, contour,
  physical verification, product identity, J1-M, rights, actual-wear, QA-preview,
  publication, Cloudflare/R2, or G1/G2/G3 claim was fabricated.

### Wave D/D3 GenerationJob v1 local evidence boundary

- Added fail-closed unknown-input GenerationJob request/event v1 contracts for tenant/model/method, generator identity/version/config digest, sorted immutable source set, measurement and generator-input digests, explicit policy/timestamps, attempts, exact statuses, worker claim/lease evidence, retry classification, and output manifest/model hash plus byte-length evidence.
- Processing identity and idempotency are canonical across source ordering, submission time, and retry-policy changes; actual processing-input mutations change identity. Submission time and retry policy remain committed in the queued event.
- Added a pure allowed-transition reducer and replay-only state derivation. Strictly increasing event time/sequence, bounded attempts, queued-only claim, exact owner/token binding, maximum 15-minute lease, deterministic expiry recovery, retryable-only retry, cancellation, terminal immutability, and review-output equality fail closed.
- Every event binds previous digest, canonical event digest, and complete job identity. Replay requires an explicit `evaluatedAt`, permits that horizon to fall inside a valid bounded active lease, and rejects missing, reordered, duplicate, altered, future-event, stale, cross-tenant/model/input, status-relabelled, and output-substituted evidence.
- Added a local-only Frame Factory CLI/store with component-by-component symlink rejection before directory creation, explicit root/relative output/evaluation cutoff, one atomic sequence CAS slot containing canonical digest-bound bytes, exclusive temporary writes, exact-byte idempotency, competing-claim collision refusal, cleanup, and sanitized machine JSON.
- Added ADR-0011 and a visibly synthetic/non-promotable request template. Proxy output hashes can reach review evidence only; no Worker execution, UI, Supabase/R2/Cloudflare/network mutation, approval, publication, deployment, Standard/Premium generation, or G1/G2/G3 pass is created.
- Automated evidence: typecheck, focused GenerationJob/CLI suites, all 223 deterministic tests, and clean diff validation pass. The local sequence CAS ignores only its own strict UUID-shaped regular pending files, preventing concurrent readers from misclassifying an in-flight atomic write while all other unknown entries still fail closed.

### Wave D/D3 local proxy-auto Processing Worker v0

- Added a pure/application composition boundary that accepts only an existing
  queued `method=proxy-auto` job. The parsed strict Proxy input's actual canonical
  digest, tenant/model, sorted sources, measurement digest, and generator
  id/version/config must exactly match the queued processing request before any
  claim is attempted.
- The local worker claims through the existing immutable sequence CAS, generates
  into an explicit contained root, rereads actual manifest and GLB bytes, hashes
  and measures them independently, reconciles manifest/GLB URL/hash/length and
  complete provenance, then applies the shared runtime-compatible GLB kernel.
- Only exact verified evidence is appended as `output-recorded`; the result is
  review with fixed fixture/draft/proxy/`recommendedForLive:false`/
  calibration-only authority. No completion, approval, publication, deployment,
  live admission, Standard/Premium, network, or cloud mutation exists here.
- Exact complete content-addressed output may be reused. Different or half-
  present output is preserved and rejected. Invocation-created partial output is
  cleaned; uncertain cleanup fails closed. Post-claim failure events use the
  documented terminal-versus-safe-retry table in ADR-0011, and CAS losers never
  create a second owner.
- The filesystem cannot atomically commit the output pair and ledger event.
  ADR-0011 documents exact replay, lease expiry/recovery, retry-queued, byte
  reverification, and `recoveryRequired` handling. There is no hidden clock or
  blind retry.
- Before claim CAS, the worker now requires a live synchronous explicit
  timeline: claim precedes output/failure, both result timestamps are at or
  before `evaluatedAt`, and `evaluatedAt` is strictly before lease expiry. This
  closes the backdated-work case where replay preserved a running state even
  though the newly proposed lease had already expired at the observation
  horizon.
- Containment/root codes are now classified before generic `TypeError`, so safe
  CLI/core failures remain sanitized terminal `OUTPUT_CONTAINMENT` or
  `ROOT_INVALID` instead of being mislabeled as identity failures. Required
  post-write rereads translate missing, symlink-swapped, and non-regular output
  to terminal `OUTPUT_VALIDATION`; no-follow prevents reading the symlink target,
  invocation-created paths are cleanup-proven, and failure evidence is recorded.
- Ambiguous claim hard-link completion is replay-resolved before output work.
  Exact published claim evidence continues safely, an unchanged prior head
  proves no claim, a competing head is contention, and an unreadable outcome
  returns terminal `CLAIM_COMMIT_UNPROVEN` with `recoveryRequired:true` rather
  than falsely reporting no mutation.
- Focused automated evidence covers happy review, deterministic reuse,
  cross-identity/config/input substitution, non-proxy methods, lease bounds,
  concurrent runners, actual-byte tamper/mismatch, partial I/O cleanup,
  failure classification, and path/symlink/privacy behavior. All inputs remain
  visibly synthetic/non-product/non-promotable; no G1/G2/G3 status changes.
- Automated evidence: typecheck, 13 focused Worker tests, 22 affected Worker/
  ledger/output-store tests, all 236 deterministic tests,
  `quality:evidence:template-check`, and clean diff validation pass.

### Wave D1 fail-closed QA decision / AssetVersion draft boundary

- Added schema-v1 canonical SHA-256 QA decision evidence with exact
  tenant/model/job/processing-input/review-head/manifest/model hash and actual
  byte-length binding, pseudonymous reviewer identity, explicit
  `reviewedAt`/`evaluatedAt`, bounded sorted issue categories, and bounded notes.
  Unknown fields, altered or substituted evidence, future/stale evidence, and
  absent/duplicate/multiple/reordered terminal decisions fail closed.
- Approve and reject are explicit distinct human decisions; there is no
  auto-approval path. Reject derives no asset. Proxy approve only derives the
  exact reviewed immutable calibration draft and never an `approved` asset.
- Asset identity/version/variant, content-addressed model/manifest URLs, hashes,
  byte lengths, sources, generation/job provenance, identity attachment,
  zero-angle non-live envelope, and status are deterministic from the verified
  job and Proxy input. Caller relabel/status escalation is not accepted.
- Physical, visual-fidelity, actual-wear, and rights requirements remain
  explicit `false` with evidence digests `null`. Derived output is fixed to
  fixture/`draft`/`proxy`/`recommendedForLive:false`/calibration-only/
  `promotable:false` and is rejected by QA-preview and public-live admission.
- Kept the boundary pure: no extra persistence/CAS protocol, CLI, network,
  Supabase/R2/Cloudflare mutation, deployment, publication, or physical evidence
  is introduced. Concurrent identical derivations are deterministic.
- Automated evidence: typecheck, 11 focused QA tests, all 247 deterministic
  tests, `quality:evidence:template-check`, and clean diff validation pass.
- This remains preparation only. `G1_SINGLE_FRAME_RUNTIME_ACTIVE` is unchanged
  with the same physical J1-M, actual-wear, and five-class live-device blockers.
  `G2_GENERATION_STRATEGY_SELECTED` and `G3_FACTORY_25_ASSETS_PASS` are not active
  or passed.

### Local Supabase/Postgres control plane and publication authority

- Added the data-free CLI-created migration
  `20260811071257_control_plane_publication_v1.sql`: 19 authoritative private
  tables cover normalized membership, tenant/site/product identities, inspected
  source/pixel provenance, measurement evidence, generation events, immutable
  AssetVersions, QA decisions, authority public identity, immutable signed
  Deployments/resources, exact-one publication-stream pointers, and append-only
  audit/publication evidence.
- Every private table has RLS enabled and forced with a normalized active-membership
  SELECT policy. The only definer helper is private, null-guards `auth.uid()`, has
  empty search path/qualified objects, revokes PUBLIC/anon/service-role execution,
  and grants only authenticated. Authorization uses no JWT metadata. The only
  exposable surface is two security-invoker API read views; there is no anon grant
  or exposed mutation RPC.
- SQL constraints and minimal triggers enforce tenant composite FKs, tenant-unique
  SKU, lowercase SHA-256, positive sizes/versions/dimensions, lower-case site domain,
  event-chain and source-geometry binding, append-only decisions/events/deployments,
  immutable asset bytes/URLs, non-promotable Proxy state, and published immutability.
- Publication authority is not catalog recommendation. Immutable URL/hash bindings
  and signed Deployment envelopes precede one stream pointer. Replacement and
  rollback both require an exact prior digest plus strictly higher revision and
  generation; synthetic verification produces activation/replacement/rollback
  events in an in-memory database only.
- PGlite 0.5.4 executes the production migration with test-only Supabase auth stubs
  outside it. Focused verification passes 60 SQL assertions across 19 forced-RLS
  tables, 19 policies, two security-invoker views, actual authenticated role switch,
  tenant isolation, constraints/immutability, and three publication events.
- No Jessica remote project exists and no unrelated Supabase project was inspected
  or mutated. No product, physical, approval, publication, deployment, actor, key,
  or gate evidence was created. G1 remains active/not ready; G2 and G3 remain
  inactive. Hosted advisors/RLS tests and every remote precondition remain pending.

## Active implementation objective

`JSC-0002_SINGLE_FRAME_RUNTIME`

Deliver a single-frame vertical slice for J1-M:

```text
camera
→ face tracking
→ pose adapter
→ scale resolver
→ confidence gate
→ One Euro filtering
→ depth-only face mesh
→ 3D frame render
```

## Non-negotiable constraints

- Face video and landmarks stay in the browser by default.
- All runtime eyewear assets are 3D GLB; quality tiers are asset-quality tiers, not separate renderers.
- Product metadata uses millimetres; glTF runtime geometry uses metres.
- Low-confidence tracking must fail closed rather than display a visibly detached frame.
- `tenantId` and replaceable catalog origin exist from the beginning; billing and full SaaS controls do not.
- No prescription-lens or medical-measurement claims in the initial product.

## Immediate next tickets

1. `JSC-0205` J1-M measurements, six source views, normalized GLB, attachment matrix, and QualityEnvelope
2. `JSC-0206` canonical 3 people × 5 frames × front/left/right actual-wear evidence
3. canonical five-class live-camera/device evidence

These remaining tickets require external physical product, consented actual-wear, or live-device input. The candidate sunglasses image may exercise the source/dimension draft path but cannot replace the six-view J1-M source set, actual-wear evidence, or device evidence.

## External dependency note

MediaPipe and Three.js are pinned, self-hosted, and exercised through the Worker by the camera-free parent-browser self-test. Physical J1-M inputs and the canonical five classes—representative iPhone Safari, lower-end iPhone/SE, mid-range Android Chrome, Windows Chrome, and Windows Firefox—remain external G1 requirements.
