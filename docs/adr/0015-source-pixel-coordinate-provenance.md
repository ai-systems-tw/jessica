# ADR-0015: Source-pixel coordinate provenance and orientation safety

## Status

Accepted.

## Context

JPEG and WebP bytes may carry EXIF orientation while common viewers display the
rotated image. The prior source record exposed only width/height from the
encoded header. A hash-correct `regionPx` or manual trace could therefore have
been selected in display space but interpreted against different raw pixels.
Legacy region evidence does not contain enough information to prove which
interpretation its author used.

## Decision

All new source inspection records a strict `pixelGeometry` derived from the
immutable source bytes. The only authoring coordinate space is the raw encoded
pixel raster: origin at encoded top-left, x right, y down, and regions
`[x,x+width) × [y,y+height)` with safe integers. `widthPx`, `heightPx`, and
source-spec `expectedWidthPx`, `expectedHeightPx` mean encoded dimensions.
`displayWidthPx` and `displayHeightPx` are deterministic derived diagnostics.
Whenever `pixelGeometry` is present, both top-level encoded-dimension aliases
are required and must exactly equal its encoded dimensions.

JPEG APP1 EXIF is parsed within segment bounds, with II/MM endian handling and
orientation values 1 through 8. Missing orientation is 1. Malformed, invalid,
duplicate-conflicting, or multi-segment-conflicting orientation fails closed.
PNG `eXIf` and WebP `EXIF` receive the same bounded TIFF treatment. WebP encoded
dimensions are read without a dependency from bounded VP8X, VP8, or VP8L
headers; conflicting headers fail closed. Author-declared orientation is not an
input field and is never trusted.

Region authoring is allowed only when inspected orientation is 1. Orientations
2 through 8 require a separately hashed orientation-normalized derived source
with explicit lineage before region evidence or manual tracing can resume; that
derived-source workflow is not implemented here. No display-to-encoded mapping
is guessed. Legacy sources without `pixelGeometry` remain acceptable only for
region-free raw-label evidence. Any legacy region or manual trace without proven
geometry fails closed.

Stable capture drafts preserve exact geometry while continuing to omit mtime.
Measurement evidence digests bind the geometry of referenced sources. Evidenced
thickness and manual-trace durable bodies carry source geometry; strict parsers
reject stripping, injection, inconsistent display dimensions, orientation
relabeling, or out-of-bounds encoded regions.

## Consequences

- Orientation metadata proves coordinate interpretation only. It does not prove
  transcription correctness, OCR, contour fidelity, or physical accuracy.
- Source SHA-256 remains the byte identity; geometry is derived provenance bound
  into downstream canonical evidence so it cannot be silently substituted.
- Existing region-free legacy draft data remains usable. Existing legacy region
  data must be reinspected and intentionally reauthored; dimensions alone are
  insufficient migration evidence.
- No production dependency, browser, network, cloud operation, product image,
  measurement, rights record, or gate authority is introduced.
