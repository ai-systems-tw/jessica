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

### GenerationJob

```ts
type GenerationJob = {
  id: string;
  tenantId: string;
  frameModelId: string;
  method: "proxy-auto" | "standard-auto" | "manual" | "external";
  generatorVersion: string;
  inputHash: string;
  status: "queued" | "running" | "review" | "failed" | "completed" | "cancelled";
  attempts: number;
  errorCode?: string;
};
```

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
