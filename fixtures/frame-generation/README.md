# Synthetic explicit-profile Proxy fixture

`proxy.synthetic.template.json` is visibly synthetic input for the deterministic
explicit-profile/parametric Proxy generator. The polygons and digests are test
data; they were not extracted from a photograph and are not a product asset.

The outer lens polygons must be counter-clockwise and the inner hole polygons
clockwise. Both arrays must start at their leftmost vertex (choosing the lower
vertex when tied). For equal point counts, `outer[i]` corresponds to
`inner[(pointCount - i) % pointCount]`; every resulting connector must remain in
the rim region without crossing either boundary or another connector. Rotating
only one array is invalid even when its polygon shape and winding are unchanged.
Holes must remain strictly inside their outer polygons. Measurements,
bridge anchors, hinge anchors, source digests, measurement digest, generator
identity/version/config digest, and candidate identity are all hash-bound.
Generated frame-width and temple-length POSITION bounds are checked after
Float32 serialization with a fixed 0.051 mm tolerance.
All GLB floats and integer headers are written explicitly little-endian.

`proxy-input-authoring.synthetic.json` is a second visibly synthetic fixture for
the capture-to-Proxy bridge. It contains no product bytes. The default path uses
an explicit non-physical thickness assumption and a dimension template; tests
also exercise unverified thickness evidence and a source/region/coordinate-bound
manual pixel trace. Complete template/trace bodies and thickness provenance are
canonical-input and manifest durable; the generator recomputes the profile body
digest and derived millimetre profile. Synthetic raw labels exercise numeric
token/value consistency only and are not OCR. The fixture does not represent
measured, verified, or extracted product geometry.

The committed region-bearing synthetic sources were intentionally migrated to
explicit orientation-1 raw-encoded `pixelGeometry`. This is test-only geometry,
not inspected product evidence. Geometry-less legacy sources remain compatible
only when every evidence record is raw-label-only; legacy regions and manual
traces fail closed because their coordinate meaning cannot be recovered.

Generate into an explicit local directory after building:

```sh
npm run build
npm run frame:proxy:generate -- fixtures/frame-generation/proxy.synthetic.template.json --output-dir /tmp/jessica-proxy-output
```

Every output is `draft`, quality `proxy`, `recommendedForLive: false`, fixture
data, and calibration-only. It cannot establish J1-M, G1 readiness, G2 ACTIVE or
PASS, contour fidelity, physical correctness, approval, or publication.
