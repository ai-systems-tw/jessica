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

刻印不存在には別のversioned provenance modelを使う。actual source artifact
自体はJSC-0212同様 `sourceRole:null` のまま保持し、capture role/specimen/timeは
独立した署名済みmappingでのみ検証する。marking inspectionはそのpayload digest、
同一candidate/source set/specimen、左右テンプル内側とブリッジ内側のclosed policy、
actor/time、independently signed actual report bytesとhost-selected supersedes headを束縛する。
`reported-no-temple-marking` はこのinspection resultではない。正式absenceでもN/Aに
できるのは刻印転記だけで、six-field verified caliper evidenceとJ1-M/G1 marking source
は維持する（ADR-0032）。

`method:"caliper"` は単独では正式実測の証明にならない。JSC-0214では、専用kindかつ
`sourceRole:null` のcanonical actual bytesとしてcalibration recordとmeasurement
sessionを保持する。sessionはclosed discriminator
`direct-physical-caliper-observation`、同一specimen/operator/observedAt/caliper、
calibration payloadと有効期間、candidate/job/source/MeasurementSet/capture provenance、
およびcanonical orderの6つの`mm`観測を署名対象にする。各観測はJSC-0212の
measurement documentのfield/value/method/sourceとexact一致しなければならない。
Calibration authorityとmeasurement authorityはtenant-scoped ES256の独立した
authority/key/JWK fingerprintを使い、後者はJSC-0212 physical authority/keyとも一致する。
この合成はdigest-only review inputを返すだけで、QA decisionやAssetVersionを作らない
（ADR-0033）。

JSC-0215の正本はmutable `QAReport` や `AssetVersion` ではなく、strict ES256 v1
`NonProxyHumanQaDecisionAttestation` である。decisionはSQL/QA contractと同じ
`approve | reject`、issue categoryは既存closed enumのunique sorted setである。
payloadはtenant/reviewer authority/key/JWK fingerprint、host-selected reviewerId、
candidate/model/variant/version、GenerationJob lineage/output、source set、MeasurementSet、
specimen、JSC-0212/0213/0214のcomposed result/payload digests、input validity horizon、
`internal-review-only` rights、reviewed/issued/expires timesを束縛する。
calibration record/session payloadだけでなく、calibration/measurement attestation
payload digestも必須とし、同じbytesの別authority/key/time再署名を別provenanceとして扱う。

Approve時だけ `ApprovedNonProxyReviewProjection` を導出する。これはcandidateの
identity/version/URL/hash/source/generation/matrix/requirementsを保存し、QualityEnvelopeは
yaw/pitchを広げずscale-confidence最低rankを弱めず、`recommendedForLive:false` のままにする。
projectionはpersisted `AssetVersion` ではなく、`assetVersionCreated:false`、
`assetVersionPromoted:false`、`activeDeployment:false`、`publication:false`、全gate false、
rightsはinternal review限定である。RejectはprojectionもQA approvalも持たない（ADR-0034）。

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

### ReprocessingRequest / ReprocessingEvent (F4 local preparation)

`ReprocessingRequest` binds tenant/site/production, SKU/model/variant, exact prior immutable version/hash and
GenerationJob/review/QA candidate identities, source/capture digest candidates, and the next generation request
identity/input hashes. Its canonical digest excludes derived request ID/idempotency fields. Raw material status is
digest-reference-only/unverified and execution authority is false.

At most five chained events derive a local plan: requested, one candidate reference, comparison, then optional
canary or rollback reference. Complete closed metrics alone can derive better/equivalent. Canary scope/traffic/time
are bounded. Rollback repeats the exact older unverified reference and remains manual/control-plane-required.
The canonical command embeds the full ledger, independently replays it, and grants no operational authority
(ADR-0024).

### ServiceReadinessProfile / ServiceUsageEvent (G6 local preparation)

`ServiceReadinessProfile` binds one tenant/site/production scope, exact parent/widget/catalog/asset HTTPS origins,
and one canonical widget URL below an exact path prefix. Its external-prerequisite record has eight closed keys,
all fixed `pending-external`; it cannot represent completion or authorization. Embed requirements are derived from
WidgetProtocol v1 plus the canonical E1 CSP/Permissions-Policy/camera boundary and remain unverified candidates.

`ServiceUsageEvent` is a maximum-256, 24-hour canonical hash chain. Each event is one occurrence of only
`widget-session-opened`, `try-on-started`, or `catalog-selection-succeeded`, repeats the exact profile/scope/origin
binding, and is `local-candidate-unverified`. The derived summary is non-billable, has no pricing, and is not real
usage evidence. The canonical command embeds/replays the full ledger, stays `local-preparation-only` with
`g6Ready:false`, and grants no tenant, origin, production, billing, legal, support, onboarding, or gate authority
(ADR-0025).

### FitIntelligenceInput / FitIntelligenceEvaluation (G7-A local preparation)

`FitProductCandidate` binds exact tenant/site/production, SKU/FrameModel/FrameVariant, the five existing
FrameMeasurements values in explicit millimetres, MeasurementSet and source-set digests, a non-authoritative
catalog-candidate status, and a derived candidate digest. `verified-physical-mm` is an upstream assertion and does
not become authenticated measurement authority here. Same-model variants share measurement digest, values, and
verification status; their source-set digests may differ and remain independently bound.

`FitIntelligenceInput` is canonical-order and content-addressed, excludes the exact reference product, and rejects
scope or identity relabeling. `FitIntelligenceEvaluation` applies the fixed `g7-a-local-v1` top-five integer-score
candidate policy, exposes an exhaustive relation per dimension plus fixed explanation codes, and carries only fixed
reference-product guidance. It marks measurement/source/catalog digests unverified, face-relative guidance
deferred, and outcome measurement pending-external/non-causal/unmeasured. The replayable command adds no
publication, personalization, physical suitability, medical/biometric, catalog mutation, analytics/remote write,
or gate authority (ADR-0026).

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
## JSC-0218 private persistence v2

- `private.qa_reviewer_authorities`: append-only exact human-QA public identity;
  only active-to-revoked is allowed. It stores no secret/private key.
- `private.non_proxy_human_qa_records`: one terminal semantic identity per exact
  candidate/version/job, retaining signed payload, signature, reviewer,
  model/variant/job/output, sorted source set, verified MeasurementSet, specimen,
  every JSC-0212/13/14 composition digest, notes/issues/envelope, reviewed/issued/
  expiry/input/review-fresh/effective horizons, bounded maximum review age,
  review-policy digest, rights, and
  the complete approved AssetVersion projection/digest when applicable.
- `private.non_proxy_asset_version_bindings`: one approve record to one exact
  AssetVersion and its row digest, variant/job/source set, raw `quality_envelope`,
  `decision_payload_sha256`, and effective expiry. The envelope has no separate
  persisted digest; the binding remains permanently non-live and publication-ineligible.
- `private.asset_version_sources`: exact tenant+AssetVersion+model+variant and
  inspected source ID+model+hash, plus deterministic immutable source-row identity.

At v2 creation these relations are private, forced-RLS, policy-free and grant-free. Approval
is immutable historical evidence; JSC-0219 must recheck the binding, active
authority, and time horizon before issuing/using any preview capability.

JSC-0219 adds a separate credentialless `NOLOGIN NOINHERIT NOBYPASSRLS`
preview-reader role with exact SELECT-only policies/grants for reconstruction.
The adapter activates it only on one pinned physical lease, takes the same
authority/candidate/job session-lock operands as the writer, repeats its locator,
and reads under `REPEATABLE READ READ ONLY`. It has no mutation, routine,
sequence, API, default/future, runtime, deployment, or publication grant.

JSC-0219B changes no persisted product/review schema and grants no new Data API
surface. It selects one pinned `node-postgres` `pg.PoolClient` as the production
carrier for this existing role and lock contract. The required PostgreSQL 17
acceptance database is disposable: it applies v1 through v4 from empty state and
uses two distinct backend sessions to prove revoke/head/status blocking and
post-release visibility. Its rows, credentials, and role memberships are test
fixtures only and are not remote or physical evidence.

## JSC-0218A trusted writer v3

The forward-only v3 support makes facts that v2 could not independently prove
available to the trusted adapter: exact canonical event timestamps and output
evidence permit the complete GenerationJob ledger to be replayed and its
output/head to be derived
from trusted ledger state rather than copied from the candidate, and verified
MeasurementSet lookup is bound to an unambiguous same-specimen identity. Exact
canonical timestamp strings are also retained alongside PostgreSQL instants for
reviewer-authority and terminal-review digest/signature reconstruction; equality
constraints bind every string to its corresponding `timestamptz`. Source
hash-to-ID resolution is likewise exact for tenant/model/variant and rejects
multiple matches; neither source nor MeasurementSet selection uses caller choice
or `ORDER BY ... LIMIT 1` ambiguity. The v3 job-policy check bounds
`max_attempts` to 1..64, and the adapter derives its complete-ledger row budget
from that committed value instead of imposing an unrelated fixed history cutoff.
It also persists the sorted unique `source_asset_sha256s`; method, generator
ID/version/config digest, MeasurementSet digest, source set, generator input,
attempt policy, creation instant, and processing identity must exactly match the
replayed genesis request and writer selection.

Each terminal review also stores `writer_committed_at` and its exact canonical
string, both set from the attempt's single `transaction_timestamp()`. Those facts
exist only if the transaction commits and make the receipt's `committedAt`
deterministic across exact retry and independently recovered commit acknowledgement;
they do not claim to be the physical network acknowledgement time.

All driver rows enter the application as hostile `unknown`, are detached and
deeply frozen in the earliest query-result continuation, and share one bounded
node/text/row/array budget for the complete transaction snapshot. Stored
`row_sha256` is never sufficient for an
exact retry: the adapter reconstructs every canonical authority, terminal review,
AssetVersion, source, and binding field, rebuilds the shared signed payload, and
re-verifies payload and signature before treating rows as equal. Partial state,
same identity with different bytes, source relabel, stale head, invalid/revoked/
expired authority or MeasurementSet, readback mismatch, and unreadable state are
terminal denial for that transaction, not repair instructions.

One cluster-global group role, `jessica_non_proxy_qa_writer`, is created only if
the name does not already exist and has exactly `NOLOGIN`, `NOINHERIT`,
`NOSUPERUSER`, `NOCREATEDB`, `NOCREATEROLE`, `NOREPLICATION`, `NOBYPASSRLS`, null
password, and zero memberships in either direction. It owns nothing and receives
only private-schema usage; SELECT on the exact generation/job-event/measurement/
source/authority/review/asset/source-binding relations; INSERT only on the exact
review/asset/source/binding relations; and `UPDATE(status)` on
`asset_versions`. It receives no sequence, routine, default/future, ownership,
API-schema, DELETE/TRUNCATE/REFERENCES/TRIGGER/CREATE, or broader UPDATE grants.
Role-aware invoker triggers additionally reject ordinary draft assets,
unrelated retire/transitions, and arbitrary review/source/binding inserts while
allowing only the relationally exact JSC-0218A write order and review-to-approved
transition. New and replaced writer-path helpers explicitly revoke effective
EXECUTE from PUBLIC, anon, authenticated, service_role, and the writer; the
pre-existing authenticated `private.is_tenant_member(text)` read helper remains.

Forced RLS remains enabled. Explicit policies name only the writer role and the
exact nine SELECT relations, four INSERT relations (`WITH CHECK`), and
`asset_versions` UPDATE (`USING` plus `WITH CHECK`); the total private policy
count after v3 is 33. PUBLIC/anon/authenticated/service_role receive no new
JSC-0218A mutation policy or grant; the 19 authenticated member-read policies
remain. Terminal candidate identity is uniquely constrained across
GenerationJobs by `(tenant_id, candidate_asset_version_id, candidate_version)`;
the terminal-review validator takes the same candidate advisory key before
collision checks. Review/internal-asset/binding/source/approval validators take
their applicable authority -> candidate -> job key subset before authoritative
reads, using pre-lock locator reads only for immutable IDs.
No RPC, view, SECURITY DEFINER function, password, service key, or Data API
mutation surface is added.

The credentialless role is part of the trusted server TCB. Its relational checks
do not independently authenticate ES256 bytes: possession of a future production
LOGIN or parent membership could submit an all-zero signature or attacker digest
that the normal application path would reject during raw-request evaluation and
full readback. The repository provisions neither credentials nor membership;
that compromise remains an explicit external residual. Reviewer-authority
registration and credential provisioning remain separate administration. See
ADR-0038.
