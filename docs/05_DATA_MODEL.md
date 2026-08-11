# Jessica Data Model v1

## 1. Identity hierarchy

```text
Tenant
  └─ FrameModel (shape)
      ├─ FrameVariant (sellable appearance/SKU)
      └─ AssetVersion (runtime geometry version)
```

A color or lens variant does not automatically create a new shape.

## 2. Core entities

### Tenant

```ts
type Tenant = {
  id: string;
  slug: string;
  displayName: string;
  status: "active" | "suspended" | "retired";
};
```

### FrameModel

```ts
type FrameModel = {
  id: string;
  tenantId: string;
  modelCode: string;
  name: string;
  lensWidthMm: number;
  bridgeWidthMm: number;
  templeLengthMm: number;
  frameWidthMm: number;
  lensHeightMm: number;
  frameThicknessMm?: number;
  pantoscopicTiltDeg?: number;
  faceWrapDeg?: number;
};
```

### FrameVariant

```ts
type FrameVariant = {
  id: string;
  tenantId: string;
  frameModelId: string;
  sku: string;
  frameColor: string;
  frameMaterial: "acetate" | "metal" | "tr90" | "combination" | "other";
  lensType: "clear" | "tinted" | "mirror";
  lensColor?: string;
  visibleLightTransmissionPct?: number;
  commerceProductId?: string;
};
```

### SourceAsset

```ts
type SourceAsset = {
  id: string;
  tenantId: string;
  frameModelId?: string;
  frameVariantId?: string;
  kind: "front" | "left45" | "right45" | "leftSide" | "rightSide" | "top" | "marking" | "annotatedOverview" | "other";
  objectKey: string;
  sha256: string;
  mimeType: string;
  widthPx?: number;
  heightPx?: number;
  pixelGeometry?: {
    coordinateSpace: "raw-encoded-pixels";
    regionConvention: "half-open-integer";
    encodedWidthPx: number;
    encodedHeightPx: number;
    exifOrientation: 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;
    displayWidthPx: number;
    displayHeightPx: number;
    regionAuthoring: "allowed" | "requires-orientation-normalized-derived-source";
  };
  captureMetadata: Record<string, unknown>;
};
```

### MeasurementSet

```ts
type MeasurementSet = {
  id: string;
  tenantId: string;
  frameModelId: string;
  version: number;
  measurements: FrameMeasurements;
  method: "marking" | "caliper" | "derived" | "mixed";
  verifiedBy?: string;
};
```

画像上の寸法注記を転記するdraftでは、各必須寸法を `MeasurementEvidence` へ結び、source SHA-256、画像上のraw label、方法、検証状態、任意のpixel regionを保存する。画像転記は `unverified` とし、ノギス確認後だけ `verified` へ昇格する。単一の `annotatedOverview` はdraft入力として許可するが、G1の6方向capture完了とは扱わない。

新規inspectionのpixel座標規約はraw immutable bytesのencoded rasterだけである。
originはencoded top-left、xはright、yはdown、`regionPx` はhalf-open safe-integer
rectangleである。`widthPx` / `heightPx` とsource specのexpected dimensionsは
encoded寸法を意味し、display寸法はEXIF orientationから導出する。
`pixelGeometry`を持つrecordではtop-levelの両encoded寸法も必須かつexact一致する。
orientation 2..8ではregion/trace authoringを禁止し、別SHAとlineageを持つorientation-normalized
derived sourceを要求する。`pixelGeometry`なしのlegacy sourceはraw-label-onlyだけを
許可し、legacy regionは意味を証明できないためfail closedする（ADR-0015）。
orientation metadataはcoordinate interpretationだけを証明し、転記の正しさ、OCR、
contour fidelity、physical accuracyは証明しない。

ローカルの private capture-draft artifact は `FrameCaptureDraft` の canonical
JSON bytes を保存する evidence envelope ではなく、同じ draft 自体の耐久コピーである。
CLI receipt の SHA-256 と byte length は final file の no-follow reread から算出する。
保存成功が意味するのは `draftValid` のみであり、`g1Ready`、verification、rights、
promotion/publication、J1-M/G1/G2/G3 authority は別契約のまま残る。

### GenerationJob

```ts
type GenerationJob = {
  schemaVersion: 1;
  id: string; // gj_<canonical processing identity SHA-256>
  idempotencyKey: string;
  tenantId: string;
  frameModelId: string;
  method: "proxy-auto" | "standard-auto" | "manual" | "external";
  generatorId: string;
  generatorVersion: string;
  generatorConfigSha256: string;
  canonicalInputSha256: string;
  status: "queued" | "running" | "review" | "failed" | "completed" | "cancelled";
  attempts: number;
  maxAttempts: number;
};
```

This is a replay-derived view, not trusted mutable JSON. The authoritative v1
record is a strict canonical event chain containing job/idempotency/tenant/model
identity, sequence, previous-event digest, event digest, explicit UTC timestamp,
and type-specific evidence. Claim events bind worker/token and a bounded lease;
failure events bind retry classification; review output binds manifest/model
SHA-256 plus actual byte lengths. `createdAt` and `maxAttempts` are committed job
policy but do not alter same-processing-input idempotency.

### Representative20Inventory (`JSC-0301`)

A versioned inventory document has one root `tenantId` and exactly 20 distinct `FrameModel` identities owned by it. It explicitly records a representative `FrameVariant`/SKU, category/material/construction/transparency/size/curvature traits, demand/continuity/shape rationale, rights status, separate source/measurement readiness, and immutable source identity/key/SHA-256/actual byte count where available. Model, model-code, variant, SKU, source-ID, cross-tenant candidates, and cross-model source-hash reuse are rejected. `synthetic` is mandatory and synthetic rows cannot become selection-ready.

### CaptureJigProfile (`JSC-0302`)

A versioned profile binds jig/camera identity, locked settings digest, distance/height, exact signed front/±15°/±25° roles, lighting/background, scale marker, caliper/angle gauge, naming convention, actual calibration artifact hash/bytes/provenance, operator checklist, and replay metadata. Human-calibrated values are nullable in a specification template; null never establishes physical calibration or run readiness.

### GenerationBakeoffEvidence (`JSC-0303`)

A versioned bakeoff binds one inventory tenant, immutable inventory/capture-profile digests, Proxy/Standard for all 20 models, and Premium for exactly three declared difficult baseline models. Each required run binds the same per-model source/measurement provenance, unique generator input/output/model/render artifacts, front/15°/25° post-run human review, size/material/visual results, supported mobile performance, correction, approval, failure, and pseudonymous timestamp/actor evidence. Commercial Reference is optional. This evidence document contains no face image, landmark, or raw human identity field.

### AssetVersion

```ts
type AssetVersion = {
  id: string;
  tenantId: string;
  frameModelId: string;
  version: number;
  quality: "proxy" | "standard" | "premium";
  generationMethod: "proxy-auto" | "standard-auto" | "manual" | "external";
  modelUrl: string;
  manifestUrl: string;
  sourceAssetHashes: readonly string[];
  attachmentMatrix: readonly number[];
  qualityEnvelope: QualityEnvelope;
  status: "draft" | "review" | "approved" | "published" | "retired";
};
```

`QualityEnvelope.scaleConfidence` は実行時scale estimateに対する最低要求値（`low < medium < high`）である。`millimetresPerPixel`が不在・非有限・非正の場合はrankを満たしていても利用不可とする。`quality` tierは見た目/制作品質の区分であり、単独の公開可否フラグではない。

### QAReport

```ts
type QAReport = {
  id: string;
  tenantId: string;
  assetVersionId: string;
  automatic: QualitySummary;
  visualDecision: "approve" | "approve-with-envelope-limit" | "correction-required" | "manual-model-required" | "unsupported";
  notes?: string;
};
```

Wave D1の現在のProxy境界では、上記の将来の集約viewを直接信頼しない。
正本はschema v1のcanonical SHA-256 decision evidenceであり、tenant/model/job、
processing identity、review ledger head、generator input、manifest/modelのhashと
actual byte length、pseudonymous reviewer、`reviewedAt`、`evaluatedAt`を束縛する。
approveはcalibration draft導出の許可に限り、AssetVersionの`approved`状態を意味しない。
rejectはAssetVersionを導出しない。物理、visual fidelity、actual wear、rightsの未証明要件は
明示的な`false`/`null` blockerとして保持する（ADR-0012）。

### ReviewOperationsWorkItem (F3 local preparation)

The F3 canonical local contract shape is not the future mutable `QAReport` view. A schema-v1 work item binds
tenant/site/production, SKU/model/variant, GenerationJob and reviewed input/output candidates, an exact
asset/version candidate, `f3-local-v1`, nonzero source/capture candidate digests, and nullable F1 demand-command/
F2 batch-log candidate digests. `provenanceStatus` is fixed to `candidate-references-unverified`: the digest
binding does not prove that any upstream ledger, source, capture, or operational authority was verified.

Each evidence event repeats the binding, chains its canonical SHA-256 to the prior event, and carries only a
closed sorted finding set and bounded correction attempt. A durable queue item embeds its full maximum-four-event
chain so it can independently replay to one of `auto-review-candidate`, `correction-required`, `manual-required`,
or `rejected`. Auto-candidate has no QA, AssetVersion, live, deployment, publication, or gate authority. The
canonical command fixes `local-preparation-only`, `g5Ready:false`, and explicit false authority fields.
`evaluationAuthority` is always `local-candidate-unverified`; evaluator IDs/versions and findings are local
candidate labels, not authenticated human review or source evidence. Closed enum arrays are frozen at runtime.

No raw reference, bytes, path, URL, media, person/session/camera/biometric field, free-form note, or commerce/
analytics payload belongs to this model. A future authenticated adapter must prove upstream evidence and a later
human-review boundary must issue explicit authority; neither is synthesized by F3 local preparation (ADR-0023).

### Deployment

```ts
type Deployment = {
  id: string;
  tenantId: string;
  frameModelId: string;
  environment: "preview" | "production";
  assetVersionId: string;
  deployedAt: string;
};
```

## 3. Constraints

- all tenant-owned rows require tenantId
- `(tenantId, sku)` unique
- `(frameModelId, version)` unique
- published asset rows immutable
- deployment changes are audited
- source hashes cannot be rewritten
- model URL uses immutable version path

### 3.1 Relational control-plane realization

ADR-0016 realizes these identities in the data-free local migration
`20260811071257_control_plane_publication_v1.sql`. Composite `(tenant_id, id)`
keys/FKs prevent cross-tenant relabeling throughout FrameModel, FrameVariant,
SourceAsset, MeasurementSet/evidence, GenerationJob/event, AssetVersion/source,
QA decision, Deployment, and publication/audit evidence.

`private` is not a Data API schema. It owns normalized membership and every
authoritative row. `api` contains only security-invoker review/read views. Their
underlying private tables have forced RLS and active-membership policies using the
current `auth.uid()`; no user/app metadata claim selects a tenant. Views cannot own
Postgres RLS, so the invoker view plus underlying-table RLS is the enforced pair.

Inspected source rows bind positive actual byte/pixel geometry, lowercase SHA-256,
and orientation provenance. Measurement evidence binds the inspected source digest
and rejects regions outside orientation-1 raw encoded geometry. Generation events,
measurement evidence, QA decisions, deployments, and audit/publication events are
append-only. Asset content identity, URLs, manifest/model/source hashes, version,
and geometry cannot be updated; only the unpublished status state machine advances,
and Proxy cannot become approved/published.

Measurement evidence applies dimension-specific bounds rather than a blanket
positive-number rule: the six millimetre dimensions are strictly positive,
`pantoscopicTiltDeg` is inclusive -45..45, and `faceWrapDeg` is inclusive 0..90.

An immutable publication-resource row binds each catalog URL to one actual-byte
digest. A signed immutable Deployment row binds the exact selector, published
AssetVersion, hashes, authority/key identity, revision/generation, and prior digest.
`publication_streams` has one primary-keyed active pointer per tenant/site/environment.
Replacement and rollback must both be new rows with revision and generation greater
than the current pointer; rollback may select a prior immutable AssetVersion but may
not reuse the prior Deployment. Pointer changes append publication evidence.
There is deliberately no catalog recommendation column or trigger input capable of
activating a pointer.

Activation also rechecks that the candidate's prior id/digest/revision/generation
is the pointer's exact current target, closing delayed stale-branch activation.
Publication streams cannot be deleted. Authority key identity is immutable and may
only transition once from active to revoked; revoked keys cannot authorize a new
Deployment. A deployment's catalog URL/hash must resolve to an immutable resource
classified as `catalog`, never a generic deployment document.

Commerce events are deliberately not added to this local Supabase control-plane
schema in E3. The application contract binds tenant/site/environment/session and the
immutable Deployment/catalog/manifest/model identity, but a fake/local sink is not a
durable analytics authority. A future production ingestion design must separately
prove authenticated tenant authorization, append-only/idempotent persistence, RLS or
private-schema access, consent, retention/deletion, and operational controls before a
remote table or mutation is introduced (ADR-0019).

Local batches nevertheless form an application-level SHA-256 chain:
`priorBatchSha256` points to the prior exact canonical batch projection and the first
batch anchors null at sequence 1. This is local ordering/idempotency evidence only;
it is not substituted for a durable database transaction or production ingestion
authority. Public-live product attribution is derived from the loader's private
verified-object proof rather than caller-authored catalog fields.
The in-memory production registry has one bounded tenant/site/production scope;
neither SKU equality nor a structurally valid product record can cross that scope.
Likewise, the production batch dispatcher accepts only its private opaque ledger;
structural reducer snapshots are replay tooling, not persistence authority.

## 4. Runtime catalog document

```json
{
  "schemaVersion": 1,
  "tenantId": "self",
  "defaultSku": "J1-M-BLACK-CLEAR",
  "entries": [{
    "schemaVersion": 1,
    "tenantId": "self",
    "model": { "id": "j1-m", "tenantId": "self", "modelCode": "J1-M", "name": "J1-M", "measurements": { "lensWidthMm": 52, "bridgeWidthMm": 18, "templeLengthMm": 145, "frameWidthMm": 140, "lensHeightMm": 40 } },
    "variant": { "id": "j1-m-black-clear", "tenantId": "self", "frameModelId": "j1-m", "sku": "J1-M-BLACK-CLEAR", "frameColor": "black", "frameMaterial": "acetate", "lensType": "clear" },
    "asset": {
      "id": "j1-m-v1", "tenantId": "self", "frameModelId": "j1-m", "version": 1,
      "modelUrl": "./j1-m/v1/frame.glb", "manifestUrl": "./j1-m/v1/manifest.json",
      "manifestSha256": "64 lowercase hex characters",
      "sourceAssetHashes": ["64 lowercase hex characters"],
      "quality": "standard", "generationMethod": "manual",
      "attachmentMatrix": [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
      "status": "published", "qualityEnvelope": { "maxYawDeg": 25, "maxPitchDeg": 15, "recommendedForLive": true, "scaleConfidence": "medium" }
    }
  }]
}
```

Manifestはasset identity/version、generator、GLB URL/SHA-256/byteLength、`format=glb`、`unit=metre`、bounds、required nodes、source hashesを持つ。catalogがmanifest実bytesをpinし、manifestがGLB実bytesをpinする。

## 5. Explicit-profile Proxy input and bundle

Wave C Proxy input schema v1 binds one tenant/model/variant/asset candidate to a
sorted immutable source SHA-256 set, measurement-set SHA-256/version and all six
required millimetre dimensions, generator identity/version/config SHA-256, and a
manual 2D front profile. Each lens supplies an outer counter-clockwise polygon
and inner clockwise hole polygon; bridge and hinge anchors make dimensional
consistency explicit.

Both polygon arrays start at the leftmost/lower vertex. With equal point counts,
`outer[i]` corresponds to `inner[(n-i)%n]`; each connector must remain strictly
in the rim region and may not cross a boundary or another connector. A rotated
inner start index is therefore rejected rather than silently changing faces.

This profile is authored synthetic/manual data. It is not described as extracted
from an image unless a future extraction boundary produces real extraction
evidence. The current generator rejects unknown fields, non-finite/out-of-range
dimensions, bad hashes, duplicate sources, winding errors, self-intersections,
degenerate polygons, escaping/intersecting holes, and profile/measurement
inconsistency.

The immutable output manifest extends the runtime-compatible manifest with
`proxyGeneration`: canonical input hash, measurement digest, sorted source
hashes, generator identity/version/config hash, GLB hash/length, actual metre
bounds, required nodes, limitations, and fixed authority fields. Those fields
are always `status=draft`, `quality=proxy`, `recommendedForLive=false`, and
`admission=calibration-only`; input cannot override them.

### Capture-to-Proxy authoring evidence

The pure schema-v1 bridge derives tenant/model and sorted source hashes from a
strict valid `FrameCaptureDraft`. Its measurement evidence digest covers the
complete authored `MeasurementSet`, exactly five source-bound evidence records,
and an explicit sixth thickness datum. Thickness is either unverified
image/marking evidence (source SHA, raw label, optional half-open integer pixel
region) or a non-physical Proxy assumption with reason, bounds, and limitations;
there is no default and no caller-asserted `verified`/caliper path.

`dimension-template` records template identity/version and fixed no-contour-
fidelity limitations. `manual-image-trace` records source SHA, half-open pixel
region, integer pixel polygons/anchors, and explicit right/up conversion rules
before deriving millimetres. Bridge-authored legacy-compatible Proxy v1 inputs
carry strict optional `authoringEvidence`; its complete thickness provenance and
discriminated profile evidence body are canonical-input/job-bound and copied to
the manifest. The generator recomputes the body digest and exact derived mm
profile. Each transcribed measurement/thickness raw label must contain an ASCII
numeric token equal to `valueMm`; decimals and composite markings are accepted,
but this is not OCR. See ADR-0013.
