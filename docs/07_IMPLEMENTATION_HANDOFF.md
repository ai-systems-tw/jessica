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
- [ ] Record live-camera iPhone Safari and Android Chrome device runs.

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
- [ ] Create at least one real actual-wear Ground Truth fixture.
- [x] Emit bridge, frame-width, lens-center, and roll errors through the quality harness.
- [ ] Record iPhone Safari and Android Chrome results.

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
