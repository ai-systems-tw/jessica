# Jessica

**Jessica** is a browser-first eyewear virtual try-on and frame-digitization platform for fashion glasses and sunglasses.

Jessica is not only a camera overlay. It is designed as four connected products:

1. **Try-On Runtime** — browser-local face tracking and 3D eyewear rendering.
2. **Frame Factory** — capture, measurement, generation, review, and publication of eyewear assets.
3. **Catalog & Delivery** — versioned models, metadata, APIs, and CDN delivery.
4. **Fit Intelligence** — later-stage relative size guidance and product recommendations.

## Product boundary

Jessica initially targets **non-prescription fashion glasses and sunglasses**.

It does not initially provide:

- prescription-lens simulation;
- medical or optometric measurements;
- guaranteed physical fit;
- perfect tracking at every head angle;
- hair segmentation or removal of the user's existing glasses.

The first useful target is more modest and more commercial: a stable, believable view from the front through light side angles, with honest failure handling when confidence is low.

## Canonical documents

- [High-level design](docs/01_HIGH_LEVEL_DESIGN.md)
- [Decomposition design](docs/02_DECOMPOSITION_DESIGN.md)
- [Gate-based roadmap](docs/03_ROADMAP.md)
- [Quality gates](docs/04_QUALITY_GATES.md)
- [Data model](docs/05_DATA_MODEL.md)
- [Review decisions](docs/06_REVIEW_DECISIONS.md)
- [G1 browser self-test evidence](docs/08_G1_BROWSER_SELF_TEST.md)
- [Current project state](PROJECT_STATE.md)

## Repository layout

```text
apps/
  try-on-web/          Browser-local single-frame runtime
  quality-harness/     Deterministic QA report CLI
packages/
  contracts/           Product, asset, and unit contracts
  runtime/             Tracking/rendering adapter contracts
  tracking/            One Euro filters and confidence state machine
  face-tracking/       MediaPipe adapter and validated face topology
  pose/                Camera, crop, mirror, FOV, and pose conversion
  scale/               Iris observation and robust scale resolution
  rendering/           Three.js GLB renderer and depth-only face mesh
  quality/             Placement and performance metrics
fixtures/
  quality/             Reproducible quality samples
scripts/               Build, static serving, and publication helpers
docs/                  Product and engineering source of truth
```

## Current implementation slice

G1's browser-local module pipeline is implemented through a deterministic calibration proxy.

Implemented now:

- millimetre/metre unit boundary;
- versioned eyewear asset contracts;
- scalar, vector, and quaternion One Euro filters;
- tracking-confidence state machine with hysteresis;
- quality-summary and gate evaluation;
- browser camera-permission shell;
- pinned MediaPipe Face Landmarker adapter and self-hosted runtime assets;
- pose/camera conversion with mirror, crop, aspect, and FOV agreement;
- iris scale median, outlier rejection, confidence, and manual override;
- pinned Three.js GLB renderer with DPR/resize lifecycle;
- dynamic depth-only MediaPipe facial mesh;
- end-to-end confidence/filter/render frame loop;
- camera-free browser self-test with a SHA-verified official portrait fixture;
- sample quality-harness CLI;
- tests and CI configuration.

Remaining G1 evidence:

- first J1-M manually authored GLB;
- actual-wear J1-M ground-truth fixture and placement report;
- iPhone Safari and Android Chrome camera/device evidence.

## Local commands

Requires Node.js 22 or later.

```bash
npm ci
npm run provision:mediapipe
npm run typecheck
npm test
npm run quality:sample
npm run dev:try-on
```

Open `http://127.0.0.1:4173` for camera tracking, or
`http://127.0.0.1:4173/?selfTest=1` for the camera-free full browser pipeline self-test.

J1-M readiness and placement evidence use fail-closed templates:

```bash
npm run j1m:check -- path/to/j1-m-intake.json
npm run quality:placement -- path/to/j1-m-placement.json
```

See `fixtures/j1-m/README.md`; the committed templates intentionally fail until real measurements, hashes, consent, annotations, and asset metadata are supplied.

## GitHub publication

The intended canonical remote is:

```text
https://github.com/ai-systems-tw/jessica.git
```

A helper is included for an authenticated environment:

```bash
./scripts/publish-github.sh ai-systems-tw/jessica
```
