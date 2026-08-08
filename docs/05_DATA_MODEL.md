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
  kind: "front" | "left45" | "right45" | "leftSide" | "rightSide" | "top" | "marking" | "other";
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

### QAReport

```ts
type QAReport = {
  id: string;
  tenantId: string;
  assetVersionId: string;
  automatic: QualitySummary;
  visualDecision: "approve" | "limited" | "correct" | "manual" | "unsupported";
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
  "variant": {
    "sku": "J1-M-BLACK-CLEAR",
    "name": "J1-M Black Clear",
    "frameModelId": "j1-m",
    "asset": {
      "version": 1,
      "modelUrl": "https://.../frame.glb",
      "attachmentMatrix": [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
      "qualityEnvelope": {
        "maxYawDeg": 25,
        "maxPitchDeg": 15,
        "recommendedForLive": true,
        "scaleConfidence": "medium"
      }
    }
  }
}
```
