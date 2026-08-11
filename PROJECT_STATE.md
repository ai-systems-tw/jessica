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
