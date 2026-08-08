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

- Pin an official `@mediapipe/tasks-vision` version.
- Self-host WASM and task model paths through configuration; do not hard-code a public CDN.
- Implement `FaceTrackingBackend`.
- Record all network requests during initialization and normal tracking.
- Provide no-face, model-load-failure, disposal, and camera-restart tests.

### Campaign 2 — Pose/camera fixture

- Freeze one canonical MediaPipe result fixture.
- Implement coordinate conversion, mirroring, object-fit crop, aspect, and FOV mapping.
- Do not mix scale estimation into orientation conversion.
- Add center and edge-of-frame fixtures.

### Campaign 3 — Renderer

- Pin Three.js.
- Load one normalized J1-M GLB.
- Add device-pixel-ratio cap and resize/orientation handling.
- Add depth-only face mesh before appearance work.
- Keep lens/environment effects minimal until attachment is correct.

### Campaign 4 — Quality evidence

- Capture the real J1-M measurements and source photos.
- Create at least one actual-wear Ground Truth fixture.
- Emit bridge and frame-width errors through the quality harness.
- Record iPhone Safari and Android Chrome results.

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
