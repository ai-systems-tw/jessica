# G2 Capture Jig v1 Protocol

## Status and boundary

This document specifies `JSC-0302` tooling for a future G2 bakeoff. It does not record a built jig, physical calibration, capture run, or G2 activation/pass. The committed `fixtures/g2/capture-jig-v1.template.json` is intentionally `template: true`; its human-calibrated values and actual calibration artifact fields are explicitly `null`, and the readiness CLI exits nonzero.

## Controlled profile

One versioned capture profile binds:

- jig version and physical fixture identity;
- camera/device identity, named locked profile, actual settings digest, distance, and height;
- exact view roles `front`, `left15`, `right15`, `left25`, and `right25`, with target yaw `0`, `-15`, `15`, `-25`, and `25` degrees respectively;
- named lighting and background profiles;
- scale-marker, digital-caliper, and angle-gauge identities and calibration references;
- deterministic raw name `{tenantId}_{frameModelId}_{variantId}_{viewRole}_{captureRunId}.{ext}`;
- actual calibration-artifact object key, SHA-256, byte length, verification time, and pseudonymous actor;
- the complete operator checklist and replay metadata.

The profile validator rejects unknown fields, missing/duplicate view roles, wrong signed target yaws, invalid hashes/byte counts, incomplete checklist structure, and malformed replay timestamps. Contract validity is separate from physical calibration and run readiness.

## Calibration procedure

1. Assign immutable identities to the jig, camera, scale marker, caliper, and angle gauge.
2. Lock the camera settings. Hash the canonical settings bytes with SHA-256; do not hash a label or reconstructed summary.
3. Measure camera-to-jig distance and camera height with the physical station in its locked position.
4. Establish each role using the angle gauge. Record the observed calibrated yaw and a tolerance approved from repeated physical measurements.
5. Establish the lighting/profile measurements and physical background color reference.
6. Record the certified scale-marker length and current caliper/gauge calibration references.
7. Serialize the calibration observation artifact, preserve its actual bytes, and record its immutable relative key, expected SHA-256, byte length, recording UTC timestamp, and pseudonymous actor ID.
8. Supply that relative artifact path to the readiness CLI. The CLI reads the contained local file, recomputes SHA-256 and byte length, and requires both to match the profile.
9. Set `template: false` only for the evidence document describing that real station.

The design does not currently support a numeric tolerance for distance, height, yaw, illuminance, color temperature, scale-marker error, or instrument drift. Accordingly, the committed template uses `null`; a human must establish those values through the physical calibration procedure. The contract only requires positive finite calibrated values and checks each observed yaw against the human-established positive tolerance. No undocumented tolerance is supplied by this protocol.

## Per-run operation

Before a capture run, complete all eight checklist items: inspect the jig; lock the camera profile; verify distance/height; verify lighting/background; expose the scale marker; zero-check the caliper and angle gauge; and verify tenant/model/variant/SKU identity. Record a unique run ID, pseudonymous operator ID, UTC capture time, protocol version, and the same camera-settings digest used by calibration. Capture every required role without renaming one role as another.

`specValid` means only that the document conforms. Recorded hash/length metadata alone cannot establish calibration. `calibrationArtifactVerified` means the CLI or caller independently inspected supplied bytes and matched both values. `physicallyCalibrated` additionally requires that byte verification, real values, instrument references, and `template: false`. `runReady` additionally requires all checklist items and replay metadata. These outputs must never be substituted for evidence that a physical capture actually occurred.

## Recalibration triggers

Recalibrate before further runs after any camera, lens, camera-setting, jig geometry, camera mount, height/distance, view stop, light position/profile, background, scale marker, caliper, or angle-gauge change; after a station impact or repair; after a calibration reference expires; when a checklist check fails; or when replay observations exceed the recorded human-established tolerance. Preserve the prior profile/artifact and increment `profileVersion`; do not rewrite old hashes.

## Provenance and command

All hashes bind immutable bytes, all timestamps are UTC, and operators/reviewers use pseudonymous IDs. Raw product imagery stays in the existing private source boundary. Run `npm run g2:jig:check -- <profile.json> <relative-calibration-artifact>`. The artifact argument must be relative, traversal-free, equal the profile `objectKey`, and contained beneath the profile directory. With no paths, the command checks the committed template without claiming byte verification and must exit nonzero. CLI read/parse failures are sanitized JSON and never include stack traces or absolute paths.
