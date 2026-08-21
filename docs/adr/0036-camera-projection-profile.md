# ADR-0036: Camera projection profiles are Deployment-bound capabilities

- Status: Accepted
- Date: 2026-08-21
- Ticket: `JSC-0217_CAMERA_PROJECTION_PROFILE`

## Context

Public-live supplied `verticalFovDeg: 50`, the renderer independently defaulted to 50 degrees, and browser
track settings were discarded as projection evidence. Browser `MediaTrackSettings` exposes neither truthful FOV
nor intrinsics, so a silent default cannot support physical placement claims.

## Decision

Define strict immutable `CameraProjectionProfileV1` in `packages/contracts`. Its canonical identity binds exact
decoded stream geometry/facing, an opaque origin-scoped device binding, calibrated `fx/fy/cx/cy`, already
rectified `distortionModel:none`, centered contain/cover display policy, calibration-artifact integrity,
production/fixture authority and provenance, validity, and ES256 signature. Parsing rejects unknown fields,
accessors, exotic prototypes, cycles, aliases, invalid numbers/ranges, and non-canonical encodings.

Production verification accepts only explicitly parsed public P-256 JWKs and yields a frozen capability. Signed
Deployment, prior pointer, and receipt bind exact profile-set ID/version/HTTPS URL/origin/SHA-256/byte length.
The exact verified set is carried in the generation-owned preflight result. Duplicate identity or duplicate
device/stream tuples are invalid, making rollover an atomic set replacement.

After permission and before backend, Worker, WebGL, or RAF construction, admission requires exactly one current
profile matching device digest, width/height, user facing mode, intrinsic video dimensions, `resizeMode:none`,
and default zoom/pan/tilt. The generation-owned bundle carries the minimum Deployment/catalog and profile-set
freshness deadline; both remain current at the exact pre-runtime boundary after any permission delay. A synchronous capability guard
checks the same evidence after detection and before every render/state commit; RAF checks before/after processing
provide defense in depth. Drift is terminal. Failures stop camera and expose fixed
`CAMERA_PROJECTION_UNAVAILABLE` semantics.

K applies to the exact decoded post-browser rectified frame. MediaPipe uses continuous top-left pixel edges:
`u=x*Ws`, `v=y*Hs`; `X=(u-cx)/fx*d`, `Y=-(v-cy)/fy*d`, `Z=-d`. No EXIF/sensor rotation remains; orientation
describes decoded geometry only. Centered contain/cover maps K into CSS pixels. Responsive changes create a new
immutable viewport snapshot from the same physical K; DPR never enters K. Three.js uses the corresponding
asymmetric projection matrix and inverse. No FOV value remains an authority.

Production mirroring is compositor-only: internal K, pose, depth, and rendering stay unmirrored with positive fx,
while CSS reflects complete video and canvas layers once. Capture uses the admitted object-fit snapshot and
reflects its complete output once. SELF_TEST uses a truthful-digest fixture-only synthetic capability, mirror
none, outside the public coordinator.

## Consequences

Profile expiry must hold at active-camera admission. V1 does not stop a session solely because wall-clock expiry
passes after start; it does stop observed source/optical drift.

Browser device IDs are origin-scoped and commonly per browser/device. A bounded static Deployment set supports
calibrated lab/kiosk allowlists, not arbitrary ecommerce customers or all units of a model. General fleet support
needs separately reviewed provisioning/session calibration or privacy-safe device-class attestation.

This ADR proves no real calibration artifact/residual threshold, five-device-class result, physical J1-M,
exact-45 actual-wear evidence, production authority/deployment, physical accuracy, or G1 PASS. G1 remains active.
