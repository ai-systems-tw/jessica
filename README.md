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
- [Current project state](PROJECT_STATE.md)

## Repository layout

```text
apps/
  try-on-web/          Camera-permission and runtime shell
  quality-harness/     Deterministic QA report CLI
packages/
  contracts/           Product, asset, and unit contracts
  runtime/             Tracking/rendering adapter contracts
  tracking/            One Euro filters and confidence state machine
  quality/             Placement and performance metrics
fixtures/
  quality/             Reproducible quality samples
scripts/               Build, static serving, and publication helpers
docs/                  Product and engineering source of truth
```

## Current implementation slice

The initial slice deliberately avoids external runtime dependencies so the foundations can be verified before MediaPipe and Three.js are wired in.

Implemented now:

- millimetre/metre unit boundary;
- versioned eyewear asset contracts;
- scalar, vector, and quaternion One Euro filters;
- tracking-confidence state machine with hysteresis;
- quality-summary and gate evaluation;
- browser camera-permission shell;
- sample quality-harness CLI;
- tests and CI configuration.

Next implementation slice:

- MediaPipe tracking adapter;
- pose/camera calibration adapter;
- Three.js depth-only face mesh and single-frame renderer;
- first J1-M manually authored GLB;
- ground-truth fixture capture format.

## Local commands

Requires Node.js 22 or later.

```bash
npm run typecheck
npm test
npm run quality:sample
npm run dev:try-on
```

Then open `http://localhost:4173` and start the camera shell.

## GitHub publication

The intended canonical remote is:

```text
https://github.com/ai-systems-tw/jessica.git
```

A helper is included for an authenticated environment:

```bash
./scripts/publish-github.sh ai-systems-tw/jessica
```
