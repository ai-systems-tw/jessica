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

1. `JSC-0202` MediaPipe-to-Jessica pose/camera adapter
2. `JSC-0202B` iris scale resolver
3. `JSC-0203` Three.js renderer shell and video/canvas alignment
4. `JSC-0204` depth-only facial occlusion mesh
5. `JSC-0205` J1-M asset and calibration fixture
6. `JSC-0206` first ground-truth placement report

## External dependency note

MediaPipe is pinned and its adapter is covered by deterministic contract tests. The task model, live camera integration, and iPhone Safari / Android Chrome evidence are not complete. Three.js remains unpinned until `JSC-0203` begins.
