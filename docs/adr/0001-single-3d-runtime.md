# ADR-0001: Use one 3D runtime

Status: Accepted

Jessica will not maintain separate 2D, 2.5D, and 3D rendering pipelines. All runtime assets are GLB. Differences are expressed as asset quality and quality envelope.

Consequences:

- one renderer and occlusion model;
- proxy assets may be geometrically simple;
- generation pipeline carries more responsibility;
- runtime branching is reduced.
