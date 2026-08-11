# Jessica 分解設計 v1.0

## 0. 文書の役割

本書は大設計を、並列実装可能な境界、パッケージ、依存関係、品質ゲート、チケットへ分解する。

実装AIは本書を優先し、局所的な都合でプロダクト境界を変更しない。変更が必要な場合はADRを追加し、大設計との整合を示す。

---

## 1. 分解の基本方針

### 1.1 レイヤー

```text
Domain Contracts
  ↓
Pure Core
  ↓
Adapters
  ↓
Applications
  ↓
Infrastructure
```

- Domain Contracts：単位、識別子、FrameModel、AssetVersion、品質契約
- Pure Core：フィルタ、状態機械、尺度計算、品質計算
- Adapters：MediaPipe、Three.js、Supabase、R2、EC Widget
- Applications：Try-On Web、Frame Factory、Quality Harness、Processing Worker
- Infrastructure：Cloudflare、Supabase、CI/CD、監査

### 1.2 依存方向

外側が内側へ依存する。

```text
apps → adapters → core → contracts
infra → application ports
```

contracts/coreからMediaPipe、Three.js、Supabaseへ依存してはならない。

### 1.3 実装単位

各チケットは次を持つ。

- 目的
- 入出力契約
- 非対象
- テスト
- 完了条件
- 依存チケット
- 変更可能範囲

---

## 2. ワークストリーム

### W0. Repository & Governance

担当：正本、CI、ADR、状態管理。

成果物：

- README
- 大設計
- 分解設計
- Roadmap
- Quality Gates
- PROJECT_STATE
- CI
- release/rollback規約

### W1. Domain Contracts

担当：製品共通の型、単位、識別子、状態。

モジュール：

- `packages/contracts/src/units.ts`
- `packages/contracts/src/frame.ts`
- `packages/contracts/src/asset.ts`
- `packages/contracts/src/catalog.ts`
- `packages/contracts/src/events.ts`
- `packages/contracts/src/sourceCapture.ts`

必須契約：

- mm/m境界
- tenantId
- FrameModel/FrameVariant分離
- AssetVersion不変
- QualityEnvelope
- catalog schemaVersion
- widget message version
- private source provenance and evidence-bound measurement drafts

### W2. Tracking Core

担当：外部SDKに依存しない追跡処理。

モジュール：

- One Euro scalar/vector filter
- adaptive quaternion filter
- ConfidenceGate
- observation window
- scale median/outlier rejection
- runtime state reducer

### W3. Face Tracking Adapter

担当：MediaPipeをJessica契約へ変換。

モジュール：

- model loader
- wasm resolver
- main-thread backend
- worker backend experiment
- landmark/matrix mapper
- deterministic tracking quality estimator（visibilityをconfidenceに使用しない）
- lifecycle/disposal

### W4. Pose, Camera & Scale

担当：座標系、画角、crop、反転、絶対サイズ。

モジュール：

- CameraCalibration
- video viewport mapping
- MediaPipe matrix conversion
- front-camera mirror conversion
- nose attachment resolver
- iris observation
- scale estimator
- low-confidence fallback

### W5. Rendering

担当：Three.jsシーンと眼鏡表示。

モジュール：

- scene lifecycle
- video background strategy
- depth-only face mesh
- GLB asset loader
- attachment matrix
- lens material
- environment map
- device quality profile
- capture compositor

#### JSC-0207 catalog client / asset integrity boundary

- `packages/contracts/src/catalog.ts` は外部`unknown` JSONをschemaVersion、tenant ownership、SKU、manifest pin、source SHA-256を含めてparseする。
- `apps/try-on-web/src/runtimeCatalog.ts` はcatalog origin policy、manifest実bytes hash、GLB実bytes hash/length、GLB v2 header/chunksを検証する。
- supported GLB profileは埋込BIN 1個、FLOAT VEC3 POSITION、有限な実bytes、metre bounds、およびactive sceneから到達可能な `FRAME_ROOT`, `NOSE_ANCHOR`, `LENS_LEFT`, `LENS_RIGHT`, `HINGE_LEFT`, `HINGE_RIGHT`, `TEMPLE_LEFT`, `TEMPLE_RIGHT` を必須とする。
- accessor rangeはBINと参照bufferViewの両方にcontainされること。accessor min/max、実POSITION bounds、manifest bounds、catalog frame widthを照合する。
- rendererは検証済みArrayBufferそのものをparseし、model URLを再fetchしない。
- fixture catalogへの2商品目追加テストを、商品追加時のTypeScript/HTML変更不要のgateとする。

### W6. Quality Harness

担当：再現可能な正解比較。

モジュール：

- fixture schema
- annotation format
- placement metrics
- jitter metrics
- performance traces
- threshold evaluator
- HTML/JSON report
- CI regression gate

### W7. Frame Factory & Processing

担当：商品をRuntime資産へ変換。

モジュール：

- capture session
- source upload
- measurement form
- generation job
- contour extraction
- proxy generator
- standard generator experiment
- Blender/trimesh pipeline
- review UI
- correction matrix
- approval/publication

### W8. Catalog, Delivery & Embedding

担当：公開、配信、EC接続。

モジュール：

- Supabase schema
- R2 object conventions
- catalog API
- immutable asset paths
- Deployment pointer
- Hosted Widget
- postMessage contract
- analytics events
- origin/CSP/security

### W9. Fit Intelligence

Gate 5以降。

- face/frame relative-width feature
- size guidance rules
- similar-size search
- explanation text
- outcome evaluation

---

## 3. パッケージ構成

目標構成：

```text
apps/
  try-on-web/
  frame-factory/
  quality-harness/
  processing-worker/
  hosted-widget/
packages/
  contracts/
  tracking/
  pose/
  scale/
  rendering/
  quality/
  catalog-client/
  widget-protocol/
  test-fixtures/
infra/
  cloudflare/
  supabase/
  processing/
docs/
  adr/
```

初期リポジトリでは、外部依存なしで検証可能な `contracts`、`tracking`、`runtime`、`quality` とカメラshellを先に実装する。

---

## 4. 中核契約

### 4.1 単位

```ts
type Millimetres = number & { readonly __unit: "mm" };
type Metres = number & { readonly __unit: "m" };
```

外部JSONではnumberだが、パース境界で検証・ブランド化する。

### 4.2 FrameModel

形状と実測値の単位。

- modelCode
- lensWidthMm
- bridgeWidthMm
- templeLengthMm
- frameWidthMm
- lensHeightMm
- thickness
- tilt/wrap

### 4.3 FrameVariant

販売SKUと外観の単位。

- sku
- frameColor
- frameMaterial
- lensType
- lensColor
- VLT等
- commerceProductId

### 4.4 AssetVersion

- frameModelId
- version
- quality
- modelUrl
- source hashes
- generation method
- attachmentMatrix
- QualityEnvelope
- status

### 4.5 TrackingResult

```ts
type FaceTrackingResult = {
  timestampSeconds: number;
  confidence: number;
  landmarks: readonly NormalizedLandmark[];
  facialTransform: Matrix4;
  imageSize: { width: number; height: number };
  quality?: TrackingQualityDiagnostics;
};
```

`confidence`はMediaPipeのface有無を1/0へ変換した値ではない。478点の完全性/有限性、in-frame比、pixel span、正規化時間残差、transform jumpをpure coreで合成した非二値値である。

### 4.6 RuntimeState

```text
idle
requesting-camera
loading-model
acquiring
tracking
degraded
lost
permission-denied
unsupported
error
```

### 4.7 WidgetProtocol

すべてのmessageに以下を持つ。

```ts
{
  protocol: "jessica-widget";
  version: 1;
  tenantId: string;
  type: string;
  requestId?: string;
  payload: unknown;
}
```

---

## 5. 依存グラフ

```text
W0 ─────────────┐
W1 ─────┬───────┼──────────────┐
        ▼       ▼              ▼
       W2      W6             W8 contracts
        │       ▲              ▲
        ▼       │              │
       W3 → W4 → W5 → Try-On Web
                    │
                    ├→ Quality Harness
                    └→ Hosted Widget

W1 → W7 Processing/Factory → W8 Catalog/Delivery → W5 asset loading

W6 receives fixtures from W4/W5/W7
W9 depends on W4 + W8 + commerce outcomes
```

---

## 6. 実装Wave

## Wave A：Foundation（並列可能）

### A1 Contracts

- branded units
- frame/variant/asset types
- validation
- schema version

完了条件：

- 不正な負数寸法を拒否
- mm/m変換に往復テスト
- tenantIdなしの公開データを拒否

### A2 Tracking Primitives

- scalar One Euro
- vector filter
- quaternion adaptive filter
- ConfidenceGate

完了条件：

- 静止ノイズを低減
- 動作時に極端な遅延を生まない
- timestamp逆行を拒否/安全に処理
- tracking/degraded/lostのヒステリシス試験

### A3 Quality Core

- median/percentile/RMS
- quality thresholds
- fixture evaluator
- JSON report

完了条件：

- 同じfixtureから決定論的結果
- threshold違反をnon-zero exitにできる

### A4 Camera Shell

- user gesture
- `playsinline`
- permission states
- track disposal
- visible status

完了条件：

- 許可/拒否/未対応/停止を区別
- 再開始でtrack漏れなし

Wave Aは本初期コミットで開始済み。

---

## Wave B：Single-Frame Vertical Slice

### B1 MediaPipe Adapter (`JSC-0201`)

入力：HTMLVideoElementまたはImageBitmap。

出力：FaceTrackingResult。

実装：

- official package version pin
- WASM/model URL external config
- initialize timeout
- detectForVideo wrapper
- no-face result
- dispose
- telemetry/network observation

テスト：

- adapter mapping unit test
- model load failure
- empty result
- timestamp monotonicity

### B2 Pose Adapter (`JSC-0202`)

実装：

- matrix convention fixture
- mirror transform
- crop/aspect mapping
- Three.js camera agreement test
- nose anchor mapping

完了条件：

- 正面基準画像で左右反転なし
- 画面中央/端で方向が一致
- unit test fixtureで変換が決定論的

### B3 Scale Resolver (`JSC-0202B`)

実装：

- iris horizontal diameter observation
- bilateral consistency
- median window
- outlier rejection
- confidence classification
- manual scale override port

完了条件：

- 低画素時にhigh confidenceを出さない
- 左右差が大きい時に降格
- Ground Truthで幅誤差を計測可能

### B4 Renderer Shell (`JSC-0203`)

実装：

- Three.js initialization
- video/canvas alignment
- GLB load
- frame root transform
- resize/orientation handling
- device pixel ratio cap

### B5 Depth Occlusion (`JSC-0204`)

実装：

- face topology
- dynamic position update
- depth-only material
- render order
- near/far validation

### B6 J1-M Asset (`JSC-0205`)

- manual initial GLB allowed
- mm measurements
- source photos
- normalized nodes
- attachment matrix
- material
- QualityEnvelope

### B7 First QA Report (`JSC-0206`)

- real-wear photo
- annotation
- runtime overlay capture
- bridge/width error
- visual review

Gate：`TECHNICAL_SINGLE_FRAME_SLICE_READINESS`。このfirst report単独はG1/canonical PASSではなく、`G1_CANONICAL_VALIDATION`はADR-0007のexact 45 cells、five device classes、全evidenceを別途要求する。

### B8 Runtime quality policy (`JSC-0208`)

- normalized quaternionからYXZ head anglesを得るpure core
- raw yaw/pitch、最低scale confidence、mm-per-pixel availabilityの同一frame fail-closed判定
- `QualityEnvelope.scaleConfidence`を最低要求値として解釈
- `public-live` / `qa-preview` / `calibration` admission matrix
- 最初のbelow-exit時刻を保持するConfidenceGate（249 msはhold可、250 msはopacity 0）
- no-frame / asynchronous pending detectを隠すgeneration-safe watchdog
- rendererはpolicyを持たず最終opacityを忠実描画
- Viewはreasons、YXZ angles、asset quality tierを公開

完了条件：visibility不変性、ランドマーク/transform異常、quaternion軸/combined/q/-q/nonunit/gimbal/invalid、scale rank、mode admission、249/250、short dip、reacquire、dispose/restart/in-flight timerをfake clockで再現可能に検証する。

---

## Wave C：Representative 20 Bakeoff

### C1 Capture Fixture

- capture jig v1
- lighting profile
- camera settings
- raw naming convention
- measurement sheet

### C2 Proxy Generator

- background removal input
- contour extraction
- hole handling
- extrusion
- basic bridge/temple generation
- GLB export

### C3 Standard Generator Experiment

- side/45-degree observations
- curve and tilt
- temple sweep
- hinge anchors

### C4 Manual Baseline

- 3 difficult frames only
- record true hours
- keep source project files

### C5 Bakeoff Report

For 20 frames:

- auto success/failure class
- correction minutes
- approval
- angle quality
- model size
- performance

Gate：`G2_GENERATION_STRATEGY_SELECTED`

禁止：このゲート前に残り480本の撮影を開始しない。

---

## Wave D：Frame Factory v0

### D1 Data/API

- SourceAsset upload
- MeasurementSet
- GenerationJob
- AssetVersion draft
- QAReport
- approve/reject

### D2 UI

- one-screen workbench
- source images
- dimensions
- 3D preview
- 3 test faces
- correction controls
- approve/reject

### D3 Processing Worker

- job claim
- idempotency key
- deterministic inputs
- output hash
- retry classification
- no overwrite

### D4 Publication

- immutable R2 path
- asset manifest
- Deployment pointer
- rollback

Gate：`G3_FACTORY_25_ASSETS_PASS`

---

## Wave E：自社EC Beta

### E1 Hosted Widget

- iframe loader
- camera permission docs
- postMessage protocol
- open/close/product switch
- error surface

### E2 Catalog Integration

- SKU lookup
- variant fallback
- unavailable request logging
- prefetch first asset

### E3 Commerce Events

- open
- permission result
- try-on started
- frame changed
- capture
- cart requested
- close
- error class

顔情報、画像、landmarkは送らない。

### E4 Static/Low-Vision UX

度入りは販売しないが、眼鏡を外すと画面が見えにくい利用者は存在する。

- large controls
- countdown capture
- optional audio cue
- still-result review after putting glasses back on
- existing-glasses overlay modeは研究扱い

Gate：`G4_SELF_EC_BETA_PASS`

---

## Wave F：100→500 Scale

### F1 Demand Queue

- unavailable try-on request count
- sales rank
- continuous-stock flag
- shape coverage

### F2 Batch Capture

- SKU scan
- type/variant decision
- raw upload
- quality check before next batch

### F3 Review Operations

- queue
- auto-approved candidates
- correction required
- manual required
- rejected

### F4 Reprocessing

- regenerate from raw assets
- compare previous QA
- canary publication
- rollback

Gate：`G5_500_CATALOG_OPERATIONAL`

---

## Wave G：外部サービス

開始条件：

- 自社100商品以上の継続運用
- 標準商品追加時間が目標内
- Hosted Widgetが複数EC条件で動作
- 法務/特許/ライセンス確認

実装：

- tenant administration
- API key / signed embed token
- per-tenant catalog
- usage metering
- service plans
- white label
- customer onboarding

初期から作らないもの：請求、独自ドメイン、複雑RBAC、営業CRM。

---

## 7. データベース分解

### 7.1 初期テーブル

```text
tenants
frame_models
frame_variants
source_assets
measurement_sets
generation_jobs
asset_versions
qa_reports
deployments
audit_events
```

### 7.2 後段テーブル

```text
users
memberships
embed_origins
api_keys
usage_events
try_on_requests
fit_rules
```

### 7.3 不変条件

- tenantId必須
- SKUはtenant内unique
- FrameVariantは必ずFrameModelを参照
- published AssetVersionは更新禁止
- Deploymentだけがactive versionを指す
- source asset hashを保存
- generation input/versionを保存
- deleteは原則soft delete/retire

---

## 8. R2オブジェクト規約

```text
private/{tenantId}/sources/{sourceAssetId}/{sha256}.{ext}
private/{tenantId}/jobs/{jobId}/...
public/{tenantId}/frames/{frameModelId}/v{version}/frame.glb
public/{tenantId}/frames/{frameModelId}/v{version}/manifest.json
public/{tenantId}/variants/{variantId}/v{version}/textures/...
runtime/mediapipe/{version}/...
runtime/environment/{version}/...
```

公開URLを上書きしない。

---

## 9. 品質試験分解

### 9.1 Unit

- units
- contracts
- filters
- state machine
- matrix mapping
- scale window
- quality statistics

### 9.2 Golden Fixture

- canonical face image/video
- canonical tracking output
- canonical pose output
- canonical rendered transform
- canonical placement annotation

### 9.3 Integration

- MediaPipe model load
- first detection
- no-face
- orientation change
- camera restart
- asset switch
- context loss/recovery

Automated coverage currently exists for model load/first detection/no-face, resize/orientation mapping, camera restart, asset switch failure, and context loss/recovery. Real orientation/device behavior remains part of device evidence.

### 9.4 Device

最低：

- iPhone Safari representative
- lower-end iPhone/SE class
- Android Chrome mid-range
- Windows Chrome/Firefox

Firefoxはカメラshell対象に含めるが、MediaPipe GPU実装差は実測で対応範囲を決める。

JSC-0209 canonical evidenceでは上記を5つの別device classとして要求し、1 runを複数classへ水増ししない。各classは3分/10分checkpoint、detection/render FPS、frame count、memory、thermal、runtime/capture/render/trace integrityと下記operational scenariosを束縛する。technical single-frame readinessは別gateでありG1 PASSを名乗らない（ADR-0007）。

### 9.5 Operational

- 3分連続
- 10分連続
- background/foreground
- permission denied then retry
- network loss after model load
- R2 asset failure
- low light
- rapid head motion

---

## 10. 並列実装ルール

### 10.1 同時並列可能

- Contracts
- Tracking filters
- Quality metrics
- Camera shell
- R2/Supabase schema draft
- capture jig documentation

### 10.2 契約確定後に並列

- MediaPipe adapter
- Pose adapter
- Renderer
- Quality UI

### 10.3 並列禁止/直列統合

- coordinate convention変更
- mm/m convention変更
- FrameModel/Variant identity変更
- widget protocol version変更
- publication semantics変更

これらは複数branchで独立変更しない。

### 10.4 統合順

```text
contracts
→ pure-core
→ adapter fixtures
→ runtime shell
→ real model
→ real camera
→ QA report
```

実カメラでしか確認できない問題を、契約・行列・fixture問題と混ぜない。

---

## 11. Definition of Done

各チケットは以下を満たす。

- 型チェック
- unit/integration test
- error path
- resource disposal
- source-of-truth文書更新
- PROJECT_STATE更新
- 既知制約明記
- 外部mutationの記録
- 秘密情報なし

Runtime変更には最低1つの再現fixtureまたは実機証跡を付ける。

Asset pipeline変更には、同じ入力から同じhashまたは差分理由を残す。

---

## 12. 初期バックログ

### 完了済み/開始済み

- `JSC-0001` repository + documents
- `JSC-0101` unit contracts
- `JSC-0102` frame/asset contracts
- `JSC-0110` One Euro filters
- `JSC-0111` confidence state machine
- `JSC-0120` quality metric core
- `JSC-0130` camera permission shell
- `JSC-0201` MediaPipe adapter
- `JSC-0202` PoseAdapter and camera calibration
- `JSC-0202B` ScaleResolver
- `JSC-0203` Three.js renderer
- `JSC-0204` depth-only face mesh
- `JSC-0205` J1-M fail-closed intake/readiness tooling
- `JSC-0206` Ground Truth annotation/report tooling
- `JSC-0205A` source-byte inspection and evidence-bound capture draft

### 次の外部入力・実機証跡

- `JSC-0205` J1-M measurements, source photos, and approved asset package
- `JSC-0206` first consented actual-wear Ground Truth fixture and report
- iPhone Safari and Android Chrome live-camera/device runs

### 次の設計補助

- `JSC-0301` representative 20 inventory sheet
- `JSC-0302` capture jig specification
- `JSC-0303` generation bakeoff protocol

---

## 13. 実装停止・相談ゲート

以下は無断で製品方針を変えず、設計判断へ戻す。

- MediaPipe以外の有料SDK契約
- 外部サービスへの顔画像送信
- Cloudflare/Supabaseの新規有料契約
- 特許ライセンス契約
- glTF単位規約変更
- 2D/2.5D別ランタイム追加
- prescription/medical scope追加
- 公開資産の上書き運用

バグ修正、無償リソース作成、ローカル実装、テスト追加、既存契約内のCloudflare/Supabase設定は実装ループ内で進めてよい。
