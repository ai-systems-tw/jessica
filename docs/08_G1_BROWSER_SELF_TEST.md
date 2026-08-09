# G1 Browser Self-Test Evidence

## Scope

This evidence verifies the browser module graph and single-frame vertical slice without claiming that the calibration proxy is J1-M or that desktop results replace mobile-device evidence.

## Reproduction

```bash
npm ci
npm run provision:mediapipe
npm run dev:try-on
```

Open `http://127.0.0.1:4173/?selfTest=1`.

Provisioning downloads exact copies of:

- [Google MediaPipe Face Landmarker float16 model v1](https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task)
  - bytes: `3,758,596`
  - SHA-256: `64184e229b263107bc2b804c6625db1341ff2bb731874b0bcc2fe6544e0bc9ff`
- [Google MediaPipe portrait fixture](https://storage.googleapis.com/mediapipe-assets/portrait.jpg)
  - bytes: `176,561`
  - SHA-256: `a6f11efaa834706db23f275b6115058fa87fc7f14362681e6abe14e82749de3e`

The runtime never requests these Google URLs. The provision step writes verified local files; browser execution uses only the application origin.

## Result — 2026-08-09 / Codex in-app Chromium

```text
SELF-TEST PASS
face landmarks: 478
confidence gate: tracking
scale confidence: high after 5 stable frames
GLB: deterministic calibration proxy visibly rendered
runtime resource requests observed: 33
external runtime requests: 0
```

The browser test also exposed and led to fixes for:

- compiled shared packages being outside the web publication root;
- `.mjs` being served as `application/octet-stream`;
- missing `three.core.js` from the self-hosted Three.js module graph;
- a portrait/self-test `cover` crop that correctly placed the face outside the visible horizontal stage;
- calibration geometry being indistinguishable against the dark stage.

## Reliability-hardening rerun — 2026-08-09

The same in-app Chromium fixture passed after camera/session, runtime cancellation, WebGL recovery, and performance instrumentation changes:

```text
SELF-TEST PASS: 478 landmarks / tracking / scale high
initialization: 452.1 ms
first detection: 1434.5 ms
first render: 1435.7 ms
detections/renders: 5 / 5
average detection: 219.74 ms
average render: 8.54 ms
```

These are cold local fixture observations, not a mobile performance pass or a sustained-FPS claim. The trace uses constant memory and is exposed on the canvas dataset for repeatable collection. The runtime asset response also returned:

```text
Content-Type: model/gltf-binary
X-Content-Type-Options: nosniff
Referrer-Policy: no-referrer
Permissions-Policy: camera=(self), microphone=(), geolocation=()
Cross-Origin-Resource-Policy: same-origin
```

Deterministic integration tests additionally cover permission denial and retry, overlapping camera requests, camera restart and track termination, initialization cancellation, replacement-asset failure, and WebGL context loss/restoration.

## Not proven by this fixture

- physical J1-M geometry or attachment calibration;
- bridge or frame-width placement error against an actual-wear photograph;
- iPhone Safari or Android Chrome camera behavior;
- temporal jitter, motion lag, thermal behavior, or sustained FPS;
- live-camera permission success in the automated in-app browser, because the permission UI remained outside page automation.
