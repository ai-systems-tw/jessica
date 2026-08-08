# OPUS Review Decision Log

## Adopted

- single 3D runtime; remove 2.5D runtime
- MediaPipe Face Landmarker and Three.js direction
- Frame Factory brought forward
- Ground Truth/quality harness before scale-out
- One Euro Filter
- depth-only face mesh in MVP
- raw capture preservation
- tenantId and replaceable catalog origin from day one
- representative 20 bakeoff before 500-item capture
- demand-based digitization priority
- external-service potential as a first-class architecture concern

## Adopted with modification

### MediaPipe transformation matrix

Use it as an input, not as a direct one-line Three.js transform. A PoseAdapter handles coordinate, mirror, crop, aspect, FOV, nose anchor, and scale separation.

### Iris scale

Use as a zero-input estimate, not a universal truth. Combine bilateral consistency, temporal median, pixel sufficiency, face ratios, and fallback modes.

### Auto extrusion

Treat as an experiment with measured approval rate, not as a promised 80–90% solution.

### Main thread vs Worker

Do not decide by theory. Implement/benchmark both backend shapes where practical. Choose per device/runtime evidence.

### Existing-glasses users

Because Jessica sells fashion glasses and sunglasses rather than prescription lenses, existing-glasses overlay is not a core optical feature. Still, large controls and timed still capture are included for users who cannot comfortably view the screen without their current glasses.

## Not adopted

- PD as a public core feature
- prescription-lens simulation
- separate 2D/2.5D renderer
- full SaaS administration in MVP
- fixed calendar deadline as completion definition
- unverified commercial pricing as a design premise
- assumption that all 500 items can be auto-generated in five minutes each

## Human direction reflected

- Product name is Jessica.
- Scope is fashion glasses and sunglasses, not prescription eyewear sales.
- Perfect tracking is explicitly not required; honest useful tracking is.
- Building a Fittingbox-like digitization/service layer is a legitimate long-term product, not incidental tooling.
