# ADR-0035: Runtime application coordinator and capability ownership

## Status

Accepted for the JSC-0216 code-reliability slice. This ADR records no physical, device,
performance, production Deployment, or gate evidence.

## Context

The pure `RuntimeLifecycle` reducer existed, but the web entry point separately owned camera,
runtime, RAF, visibility, and error handling. Asset/runtime failure could dispose rendering while
leaving camera active; track termination could leave runtime work scheduled; raw loader errors could
reach UI. Independent generation counters also allowed old asynchronous work to contend with restart.

## Decision

One `RuntimeApplicationCoordinator` owns the public-live session. It completes immutable signed
Deployment and asset admission before camera acquisition and before constructing Worker/backend or
WebGL/renderer resources. It then drives the existing reducer through camera, model, and tracking
actions. A separate UI `phase` represents preflight/starting/running/stopping without duplicating
RuntimeState semantics.

Every operation captures a generation. Teardown operations are serialized, invalidate preflight,
RAF and runtime work, synchronously initiate fail-closed runtime hide/disposal and camera/video close,
then permit only the still-current terminal generation to publish RESET or failure. Permission denial
and unsupported use their dedicated reducer actions. All other public failures map to closed codes and
fixed messages; raw exception messages are diagnostic input only and never public output.

Track end, tracking/process failure, model/asset failure, RAF failure, page hide/destroy, backgrounding,
and WebGL context loss use the same terminal teardown boundary. Context loss requires explicit restart;
context restoration cannot revive a disposed session. SELF_TEST is an explicit calibration mode with
live controls disabled and page-lifecycle disposal.

Backend initialization uses a per-generation capability. Disposal signals local cancellation and calls
the active backend cancellation immediately. A later initialization waits for the prior backend operation
to settle, preventing both double-dispose and stale-completion ABA against a replacement capability.

## Consequences

Deterministic fake-port tests can prove ordering, cancellation, observer containment, stale-result denial,
and exactly-once coordinator resource disposal. Detection and render cadence remain coupled; changing that
policy requires later device/performance evidence. G1 remains active and not passed.
