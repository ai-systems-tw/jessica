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
- [x] Test asset replacement failure and WebGL context loss/restoration with fail-closed rendering.
- [x] Stop camera/tracking on page hide or background transition; require an explicit restart.
- [x] Add delivery headers for MIME sniffing, referrer leakage, camera permissions, and same-origin runtime assets.

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
- [ ] Bind production catalog selection to an authenticated active Deployment pointer in the control plane.

### Campaign 8 — Preemptible tracking Worker

- [x] Define a versioned, unknown-field-rejecting session/generation/request Worker protocol.
- [x] Move MediaPipe initialization and synchronous `detectForVideo` off the public-live UI thread.
- [x] Pin and actual-byte verify the same-origin model before SDK initialization; use a concrete Worker-resolvable vision module URL.
- [x] Enforce one-in-flight/latest-frame backpressure, transfer ownership, close-on-every-path, timeout termination, restart, monotonic timestamps, and stale suppression.
- [x] Keep the exact 250 ms UI visibility watchdog independent from the longer Worker inference timeout.
- [x] Add fake-Worker/protocol/packaging/origin regression coverage.
- [x] Rerun the camera-free real-browser self-test through the classic-bootstrap/ES-module Worker build: 478 landmarks, 3/3 results, zero Worker errors/external origins, and watchdog hidden.

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
