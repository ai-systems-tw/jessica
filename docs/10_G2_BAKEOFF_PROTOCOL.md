# G2 Representative 20 Generation Bakeoff Protocol

## Status and non-claims

`JSC-0301`–`JSC-0303` provide G2 preparation tooling only. G1 remains `G1_SINGLE_FRAME_RUNTIME_ACTIVE` and blocked on real J1-M, consented actual-wear, and live-device evidence. No committed fixture is a real product selection, rights clearance, capture, physical jig calibration, Blender baseline, commercial VTO comparison, device measurement, or human review. G2 is not ACTIVE or PASS.

## Representative inventory

The versioned inventory has one root `tenantId` and exactly 20 distinct `FrameModel` identities owned by that tenant. Each row explicitly identifies one representative `FrameVariant`/SKU without treating a color or lens variant as a new shape. Tenant model codes, variant IDs, SKUs, source IDs, and immutable source byte hashes cannot be duplicated or relabeled.

Every candidate records category, materials, construction, transparency, size class, curvature class, demand, continuity, shape rationale, rights status/reference, separate source and measurement readiness, and any immutable source object key/SHA-256/actual byte count available. Coverage requires acetate/cell, metal, brow, transparent, sunglasses, small, large, high-curve, and rimless. One frame may honestly cover multiple traits. `representativenessPass`, `commercialRationaleReady`, `rightsReady`, and `captureReady` are separate; final selection also rejects `synthetic: true`.

Run `npm run g2:inventory:check -- <inventory.json>`. The default synthetic exact-20 fixture exercises overlap and must still exit nonzero because it has no real selection, rights, sources, or measurements.

## Evidence cells and execution

Bind the bakeoff document to one inventory tenant plus immutable inventory and capture-profile digests. Declare exactly three distinct `premiumBaselineModelIds` from the 20-model inventory. Require Proxy and Standard for all 20 models plus Premium for those three difficult baseline models: 43 required internal cells. Premium runs for any other model fail closed. A `Commercial Reference` cell is optional and its absence does not make an otherwise complete internal bakeoff incomplete.

Each run must use the inventory tenant and binds model identity; a canonical source-digest set and measurement digest shared by that model's required methods; generator identity, version, and config digest; unique cross-cell input/output/model hashes and actual byte counts; unique front/15°/25° render hashes and per-angle human review; size error; material and visual review; supported mobile device/runtime/FPS; correction count/minutes; approval; first-pass state; failure classification; timestamps; and pseudonymous actors. Reviews and performance evidence are post-run and no later than `evaluatedAt`. Unknown fields, missing reviews/performance, substitutions, duplicate cells, and artifact relabeling fail closed. Do not include face imagery, landmarks, raw personal identity, or other biometric payloads in this contract.

Recommended order:

1. Freeze the selected, rights-cleared, capture-ready inventory and hash its exact bytes.
2. Physically calibrate the jig and hash the profile/artifact exact bytes.
3. Capture all required source roles and measurements under those frozen identities.
4. Run Proxy and Standard from the bound inputs; retain generator config/input/output exact bytes.
5. Produce the Premium human baseline and record actual correction work. The three difficult manual baselines described in decomposition are real work and cannot be synthesized by the tooling.
6. Review front/15°/25°, size, material, and overall visual results using pseudonymous actors and UTC timestamps.
7. Measure actual runtime performance on the stated device/runtime and record model bytes.
8. Evaluate only after all 43 internal cells are complete.

## Metrics and stop signals

The evaluator uses the 20 Standard cells for the strategy-selection gate:

```text
auto first-pass approval >= 50%
standard correction median <= 10 minutes
manual-model share <= 25%
```

The gate boundaries are inclusive at 10 minutes and 25% as specified in the quality source of truth. The evaluator separately reports strict stop signals:

```text
any Standard correction > 15 minutes
manual-model share > 25%
any measured mobile runtime < 20 fps
```

Thus 15 minutes, 25% manual share, and 20 fps do not themselves trigger their strict stop signals; 10 minutes and 25% still pass their inclusive gate metrics. Stop signals never masquerade as gate metrics. A strategy is selection-ready only when the document is valid, all internal evidence is complete, metrics pass, no stop signal fires, and `template` is false.

Run `npm run g2:bakeoff:check -- <evidence.json>`. The default committed placeholder has zero runs and must exit nonzero while separately reporting document validity, evidence completeness, undefined metrics, stop signals, and strategy-selection readiness.
