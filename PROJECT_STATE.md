# Jessica Project State

## Canonical identity

- Product name: `Jessica`
- Intended repository: `ai-systems-tw/jessica`
- Initial business scope: fashion glasses and sunglasses
- Architecture status: high-level design and decomposition design frozen for implementation
- Current gate: `G0_FOUNDATION_ACTIVE`

## Completed in the initial implementation slice

- Repository structure and source-of-truth documents
- Unit and asset contracts
- Tracking filter primitives
- Confidence/failure state machine
- Quality metrics and deterministic sample report
- Camera-permission browser shell
- Automated tests and CI workflow

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

1. `JSC-0201` MediaPipe Face Landmarker adapter
2. `JSC-0202` MediaPipe-to-Jessica pose/camera adapter
3. `JSC-0203` Three.js renderer shell and video/canvas alignment
4. `JSC-0204` depth-only facial occlusion mesh
5. `JSC-0205` J1-M asset and calibration fixture
6. `JSC-0206` first ground-truth placement report

## External dependency note

The repository currently compiles and tests without downloading MediaPipe or Three.js. Their versions must be pinned only when the first runtime adapter is integrated and tested on iPhone Safari and Android Chrome.
