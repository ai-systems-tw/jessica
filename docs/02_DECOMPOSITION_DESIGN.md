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

The Frame Factory capture-author application may persist a valid draft only as
canonical local-private evidence beneath an explicitly configured existing
private root. Its adapter rejects traversal, absolute/Windows-absolute paths,
symlink or non-directory parents, existing targets, and containment escapes;
publishes flushed `0600` bytes through an exclusive temporary file and atomic
hard link; and hashes only a no-follow reread of the final file. The receipt is
sanitized and draft validity remains independent from G1 readiness. This local
transaction creates no verification, promotion, publication, or gate authority
(ADR-0014).

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
- versioned Worker protocol and production host backend
- landmark/matrix mapper
- deterministic tracking quality estimator（visibilityをconfidenceに使用しない）
- lifecycle/disposal

#### Tracking Worker boundary

- `packages/face-tracking/src/workerProtocol.ts` はsession/generation/request、strict microsecond timestamp、resource pins、plain-data result/no-face/error/disposed、diagnostics、transfer ownershipをunknown inputからfail-closed検証する。
- `packages/face-tracking/src/workerFaceTrackingBackend.ts` はproduction main-thread adapterであり、Workerと`createImageBitmap`非対応を拒否する。inferenceは最大1、queueはlatest最大1とし、drop/close/accountingを決定論的に扱う。
- `apps/try-on-web/public/tracking-worker-bootstrap.js` はMediaPipe Tasks Vision 1.0.1のclassic `importScripts` WASM-loader互換性だけを提供し、module listener準備前のinitをbuffer/replayする。Jessica処理本体は`apps/try-on-web/src/tracking.worker.ts`であり、ここだけがlive pathのMediaPipe初期化と同期`detectForVideo`を実行する。document import mapを仮定せず、allowlist済みconcrete vision module URLをdynamic importする。
- modelはsame-origin/no-credential/no-storeで1回取得し、redirect、Content-Length、bounded read、actual byte length、SHA-256を検証したbufferをSDKへ渡す。WASM/module/modelのconfigured URLとWorker-side resource originをdiagnosticsへ返す。
- transferred frameはpost成功前main所有、成功後Worker所有とし、全success/error/timeout/stale/dispose/restart pathでcloseまたはterminate releaseする。
- 250 ms visibility leaseはWorker inference timeoutと独立し、pending inference中もmain event loopが進めばexact boundaryでhideする。same-thread UI event-loop stallのabsolute preemptionは非保証である。

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

#### JSC-0210 active Deployment proof / public-live selection

- `packages/contracts/src/deployment.ts` はversioned Deployment payloadをunknown JSONからfail-closed parseし、tenant/site/environment、exact active pointer、SKU/model/variant、immutable AssetVersion、revision/generation、activation/audit、catalog/manifest/model hashes、allowed origin、prior deployment digestを表現する。
- `packages/runtime/src/deployment.ts` は署名方式やbrowserへ依存せず、active stream uniqueness、host freshness floor、issued/activated/expires、maximum age/lifetime、strict monotonic revision+generation、exact prior receipt chainを評価する。
- `apps/try-on-web/src/runtimeDeployment.ts` はhost固定 `keyId → authorityId + P-256 public JWK` でES256 envelope payload bytesをJSON parse前に検証する。queryはallowlist内deployment URLだけを選べ、key/hash/SKU/catalogを自己申告できない。
- generic catalog loaderは`public-live`を常に拒否する。唯一のpublic-live application pathがverified Deploymentをprivate catalog loaderへ渡し、catalog actual bytes hashからmanifest/model/renderer exact bytesまで一回取得で束縛する。
- monotonic receipt storeはtenant/site/environmentをJSON tupleでkey化し、Web Locks内で再read + compare-and-setしてrollback/replayを拒否する。fresh browserの保証はhost floorとsigned expiry/maximum age/lifetimeまでで、外部online freshness authorityなしのabsolute replay preventionは非保証とする。
- `qa-preview` / `calibration` は既存の明示pathを維持し、deployment風plain objectでpublic-liveへ昇格できない。

#### Wave C deterministic explicit-profile Proxy boundary

- `packages/assets` はGLB v2 header/chunk、JSON/BIN、active-scene node到達性、全accessor/bufferView containment、有限FLOAT VEC3 POSITION実bytes、accessor min/max、metre boundsを検証する共有kernelである。runtime catalogとframe generationは同じkernelを使用する。
- `packages/frame-generation` はversion 1のstrict unknown-inputを受けるpure coreである。candidate tenant/model/variant/asset identity、immutable source SHA-256 set、measurement-set SHA/versionと必須mm寸法、generator id/version/config digest、明示的manual 2D profileをcanonical hashへ束縛する。
- profileは左右それぞれのouter CCW / inner CW polygon、bridge/hinge anchorを持つ。両polygonはleftmost/lower vertexから開始し、`outer[i] → inner[(n-i)%n]` connectorがrim内に留まりboundary/connectorと交差しない明示point correspondenceを必須とする。self-intersection、縮退、hole escape、回転misalignment、範囲外、寸法不整合をfail closedする。これは画像輪郭抽出ではなくexplicit-profile/parametric Proxyである。
- mmからmetreへの変換はgeometry construction境界で一度だけ行い、Float32はhost architectureに依存せずDataViewでlittle-endian serializeする。出力GLBは`FRAME_ROOT`、front rims、bridge、左右templeとruntime anchor nodesを持ち、active sceneからreachableなmeshだけのactual boundsでframe width/temple lengthを検証する。bounds/render差分を閉じるためreachable mesh nodeおよびそのmesh-affecting ancestor上のmatrix/TRSは、identity値を含めて拒否する。transform-only anchor leafは有限・正形なmatrix/TRSに限り許可する。全declared mesh/accessor bytesは到達性にかかわらず構造検証し、triangle mode、indexed/non-indexedの3要素cardinality、index範囲を強制する。
- 出力bundleはcontent-addressedで、常にfixture、`draft`、`proxy`、`recommendedForLive: false`、calibration-onlyである。public-live/qa-previewへのauthorityを持たない。
- `apps/frame-factory/proxy-generate-cli.mjs` は明示local output directoryだけへGLB/manifestを書き、overwrite/collisionを拒否する。strict validation detailをstdoutへ出さず、write failureでは本invocationが作成した両fileだけをcleanupする。Cloudflare、GenerationJob、UIは本境界の対象外である。
- `proxyInputAuthoring` はstrictな `FrameCaptureDraft` のtenant/model/source SHAだけを信頼し、five-dimension evidenceへ明示thickness evidenceまたはnon-physical assumptionを加えてmeasurement digestを導出する。転記raw labelはvalueMmと一致するASCII numeric tokenを必須とするがOCRは行わない。dimension-templateはcontour fidelityを主張せず、manual-image-traceはsource SHA/half-open pixel region/integer trace/coordinate rulesへ束縛してからmm profileを導出する。完全なdiscriminated profile bodyはcanonical Proxy inputとmanifestへ残り、generatorがbody digestを再計算しmm profileを再導出してexact一致を要求する（ADR-0013）。
- source inspectionはJPEG APP1、PNG eXIf、WebP EXIFのbounded TIFF orientationとJPEG/PNG/VP8X/VP8/VP8L encoded dimensionsをactual bytesから導出する。座標規約はraw encoded top-left/x-right/y-downとhalf-open safe integersで、expected width/heightもencoded semanticsである。orientation 2..8、geometry欠落legacy region、geometry stripping/injection/conflictはcapture/Proxy strict boundariesでfail closedする。raw-label-only legacy evidenceだけはunambiguous compatibilityとして残す。measurement/profile digestはreferenced source geometryを束縛する（ADR-0015）。

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

#### Local Supabase control-plane boundary

- `supabase/migrations/20260811071257_control_plane_publication_v1.sql` is the
  data-free relational foundation. Authoritative rows and normalized membership
  live in the unexposed `private` schema; only narrow `security_invoker` review/read
  views live in the exposable `api` schema.
- Every private base table has forced RLS and an active normalized-membership
  predicate. No JWT metadata authorizes a tenant. `anon` receives no access, and
  there is no exposed mutation function.
- Immutable signed Deployment envelopes are separate from the exact-one current
  publication-stream pointer. Replacement and rollback both insert a higher
  revision/generation envelope chained to the current digest before moving the
  pointer. Catalog recommendation never moves it.
- PGlite tests supply Supabase auth stubs outside the production migration and
  execute the migration, constraint failures, grants/policy catalog, role-switched
  tenant isolation, and publication lineage locally. Hosted Supabase RLS/advisor
  verification remains a remote-apply precondition (ADR-0016).

### W9. Fit Intelligence

Gate 5以降。

- face/frame relative-width feature
- size guidance rules
- similar-size search
- explanation text
- outcome evaluation

G7-A local preparation implements only product-to-product comparison over the five existing FrameMeasurements
millimetre fields. `g7-a-local-v1` binds exact tenant/site/production and immutable SKU/model/variant plus
measurement/source candidate digests. Its frozen top-five integer-score policy is an externally unvalidated
non-production candidate policy. Relations cover all five dimensions and fixed text describes reference-product
guidance only. Face-relative width requires later calibrated physical/device evidence; outcome measurement remains
`pending-external` until semantics and operational authority are separately defined. No input or result grants
publication, personalization, personal suitability, medical/biometric, catalog, analytics, remote, or
G1/G2/G5/G6/G7 authority (ADR-0026).

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

Application coordinatorはこのreducerを実app pathで直接使用し、別state machineを作らない。
ただしimmutable preflightやserialized teardownの進行中UI制御は`phase` (`preflight` / `starting` /
`running` / `stopping`)として直交的に表現する。preflight中はRuntimeState=`idle`のままでもStartを
無効、Stopを有効にしてAbortSignalとgenerationを取消す。resource teardownはRAF/watchdogを
invalid化し、runtime disposeによる同期hideとWorker/backend cancellationを開始した直後、非同期
dispose完了を待たずcamera track stopとvideo clearを行い、その後runtime disposalをawaitする。
完了後のstate遷移は同じterminal generationだけが行う。

Injected portsはpreflight loader、camera、runtime factory、RAF、page lifecycle、calibration、
diagnosticsである。observer/diagnostics/remover/RAF callback例外はprimary ownershipから隔離する。
SingleFrameRuntime backend initializationはgeneration capabilityを持ち、pending initializeのdisposeは
backend cancellationを即時に呼ぶ。replacement initializeは旧backend operationのsettle前に開始せず、
旧完了が新capabilityをdisposeするABAを禁止する。

### Camera projection profile admission (`JSC-0217`)

- Pure versioned wire schema/parser/canonical identityは`packages/contracts`、WebCrypto trust、verified-set
  capability、active-camera admission、viewport geometryはruntime/appへ置く。
- Deployment/current pointer/prior pointer/receiptは同じstrict profile-set binding parserを使う。exact
  frozen verified setはgeneration-owned preflight bundleで渡し、mutable globalへ置かない。
- Admissionはpost-browser decoded geometryとorigin-scoped device bindingをexact matchする。rescale、
  aspect swap、missing facing/video size、crop-and-scale、zoom/pan/tilt、stale/ambiguous set、および
  inference中を含むpost-admission source driftをfail closedにする。
- `CameraCalibration`は同じadmitted projectionからのみ作るimmutable snapshotである。physical Kは固定し、
  CSS viewport generationごとにcentered contain/cover mappingをatomicに導出してpose/scale/depth/
  renderer/captureへ同じsnapshotを渡す。horizontal irisはfx-equivalent source-x units、DPRはK外である。
- Mirror ownerはcompositorだけで、video+canvasを一度反転しmathはunmirrored。fixture-only SELF_TESTは
  public coordinatorへ入れない。最大64件のstatic setはlab/kiosk exact-device allowlistであり、一般fleet
  には別設計のprovisioning/session calibrationまたはprivacy-safe attestationが必要である。

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

v1の実装正本は`packages/contracts/src/widgetProtocol.ts`とする。全messageはexact
direction/tenant/session/request/reply correlationを持ち、unknown/prototype/accessor/cycle/
nonfinite/depth/sizeをunknown inputから拒否する。親commandは`init`/`open`/`close`/
`skuChange`、widget eventは`ready`/`opened`/`assetChanged`/`captureCreated`/
`cartRequested`/`closed`/`error`と、非同期permission/runtime開始を区別するためだけの
`cameraPermission`/`tryOnStarted`である。captureはbounded local opaque referenceだけ、
errorはstable code/classとsanitized textだけとする。biometric/face/video/image/landmark/
transform/pose/scale/raw analyticsのnested alias、bytes/blob/data URLを禁止する（ADR-0017）。

safeParse APIはunknownをthrowさせずstable generic rejectionだけを返す。両adapterはvalid/
bound/collision-free inbound requestIdをlifecycle dispatch前にreserveする。parent pendingは
command別rollback state、candidate SKU、close reasonを保持し、recoverable correlated errorを
init→created、open→ready、SKU change→unchanged open、close→exact pre-close ready/openへ戻す。
spontaneous recoverable errorはready/openだけでstate不変、nonrecoverableはclosedである。
widget response transport/collision failureはcontrollerを再実行せずlocal closedにする。

initializing/opening中のpage hide/destroyはpendingを破棄し、bound iframeへexact closeを
best-effort postしてreply非依存でterminal stateへ移る。queued callbackはterminal stateを
変更できない。parent observer例外をcontainし、listener registrationはtransactional cleanup、
widget public outboundはclosed/destroyed後transport-inertとする。

両adapterのsent/received replay ledgerはcombined unique ID exact 256件/sessionを上限とする
（`WIDGET_MAX_SESSION_MESSAGES`）。commandはcorrelated response分もeffect/post前にreserveし、
old IDをevictしない。超過時はpendingをclear、local closed、stable `MESSAGE_LIMIT` observer
通知だけとしてprotocol echoを送らず、その後はtransport-inertとする。malformedおよびwrong
origin/source/tenant/sessionはledger admission前に拒否するためbudgetを消費しない。これは
browser-local memory boundであり、production remote rate limit/abuse monitoringはdeferredである。

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
- committed-review QA-previewはgeneric loaderから分離する。server-only coreは
  issue/useの各回で認証sessionとauthoritative DB stateを再検証し、同一processの
  service-instance-local opaque capabilityをuse前にburnする。返すeligibilityは
  runtime authority=falseで、browserはmint/verifier/専用loaderをimportしない。
  generic QA loaderはfetch前に拒否する。typed DB portのreference adapterは
  dedicated SELECT-only role、pinned session、authority→candidate→job locks、
  REPEATABLE READ READ ONLY、canonical persistence-plan/ES256再構成を実装する。
  production providerはpinned `node-postgres` `pg.PoolClient`とし、locatorから
  unlock/resetまで同じclientを使い、ambiguous boundaryではrepoolせずdestroyする。
  JSC-0220はdigest-pinned PostgreSQL 17.11 Linux serviceと二つの異なるbackend
  sessionでblocking/race、exact DB-clock expiry、statement-timeout rollback、
  discard/recoveryを検証済みである。signed/online one-shot transport、runtime
  integration、production host pool/TLS/credential設定は引き続き別のrequired
  acceptance itemとする（ADR-0039）。
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

The current photo-independent D1 preparation slice adds a strict Proxy QA
boundary only. One canonical terminal decision binds the exact tenant/model/job,
processing identity, review ledger head, generator input, and manifest/model
hash plus actual byte lengths. Reviewer identity and explicit
`reviewedAt`/`evaluatedAt` are required; unknown fields, altered digests,
duplicate/multiple/reordered decisions, future/stale evidence, and substitutions
fail closed. Approve and reject are distinct human evidence; no automatic
approval exists.

Proxy approve means only “derive an immutable calibration draft.” Asset
identity/version/variant, content-addressed URLs/hashes/lengths, sources,
generation provenance, identity attachment, zero-angle/non-live envelope, and
status are deterministically reconstructed from the exact reviewed output and
bound Proxy input. They cannot be supplied as relabels. The result remains
fixture/`draft`/`proxy`/`recommendedForLive:false`/calibration-only/
non-promotable. Reject derives no AssetVersion. Physical, visual-fidelity,
actual-wear, and rights requirements remain explicit `false` with `null`
evidence. This pure boundary adds no filesystem/database adapter, network,
Supabase/R2/Cloudflare mutation, approval status, publication, deployment, or
gate progress (ADR-0012).

The non-Proxy hand-off is split into two fail-closed stages. JSC-0211 derives
only the complete unverified candidate draft from one reviewed non-Proxy
GenerationJob. JSC-0212 then replays that derivation, re-parses the complete
candidate, and verifies the actual source/measurement/visual/actual-wear/rights/
model/manifest bytes plus
canonical job/decision bytes and four scope-authorized ES256 attestations.
Signed artifact descriptors, the six verified-caliper physical dimensions,
consent retention, internal-review-only rights, candidate
digest, source/MeasurementSet set, review head, generator input and actual output
are immutable cross-bindings. A valid result is only
`evidence-package-verified-for-authorized-human-review-input`; every QA/AssetVersion/live/Deployment/
publication/gate authority remains false (ADR-0030, ADR-0031).

Marking absence is not a caller-selected exemption. JSC-0213 preserves every
JSC-0212 actual source and signed descriptor at `sourceRole:null`, then verifies
roles in a separate host-trusted ES256 capture-provenance mapping. An independent
inspection attestation binds that payload digest, the exact candidate/source set,
one specimen, actor/time, and a host-selected independently signed report head. Its closed
v1 policy requires distinct `marking` captures for the left-temple inner,
right-temple inner, and bridge inner surfaces (ADR-0032).

`reported-no-temple-marking` remains only a report. Only all-three-surface absence
derives `no-dimension-marking-observed-under-policy`; any observed dimension
marking keeps transcription required. Absence can disable only the marking
transcription route. All six verified-caliper dimensions and the J1-M/G1
`marking` source rule remain required. The evaluator grants no QA, AssetVersion,
live, Deployment, publication, or gate authority.

JSC-0214 composes both prior boundaries instead of accepting their cached
results. It re-evaluates the complete JSC-0212 and JSC-0213 requests under a
host-only clock, trust maps, and lineage heads, then verifies dedicated
canonical actual bytes for a calibration record and measurement session. The
session's closed provenance class is
`direct-physical-caliper-observation`; image annotations, marking transcription,
reported/user absence, and assumed thickness cannot be selected or relabelled
into it. Exactly six ordered `mm` observations must match the JSC-0212
MeasurementSet values, source, method, authority and key, while specimen,
candidate, job, source set, and capture payload must match JSC-0213.

Calibration and measurement use independent tenant-scoped ES256 authorities,
key IDs, and host-JWK fingerprints. Calibration must precede, cover, and remain
valid for the observations and evaluation horizon. The immutable result contains
only digests and time bounds and keeps every QA/AssetVersion/live/Deployment/
publication/gate authority false (ADR-0033).

JSC-0215 closes only the pure authenticated human-review boundary. It accepts
the complete raw JSC-0214 request plus one strict signed decision, internally
replays JSC-0212/JSC-0213/JSC-0214, and rejects caller-cached results. The host
trust record selects the exact tenant, authority, scope, reviewer identity, key,
fingerprint, and JWK. That reviewer authority/key/fingerprint must be independent
from every formalization/report/capture/inspection/calibration/measurement root,
including same-JWK aliases.

The signed `approve | reject` payload binds exact candidate/model/variant/version,
job lineage/output, source set, MeasurementSet, specimen, all composed result and
payload digests, upstream validity horizon, internal-review-only rights, closed
issues, envelope, and review/issuance/expiry. `reviewReadyAt` is derived from the
replayed job and earlier candidate decision plus all later evidence, capture,
inspection, calibration, observation, and issuance times; it is never supplied
by the caller. Approve alone derives an immutable
`approved-non-proxy-review-projection` with an equal-or-narrower non-live
QualityEnvelope. Reject derives no projection or QA approval. Neither path
creates/promotes an AssetVersion, admits runtime/catalog use, deploys, publishes,
mutates a database, or changes any gate (ADR-0034).

Composition identities exclude host `evaluatedAt` while retaining stable
evidence fields, payload digests, and validity heads. The clock remains host-only
evaluator input/output, so an unexpired signed decision is durable across later
honest verification times rather than being bound to its first replay.

### D2 UI

- one-screen workbench
- source images
- dimensions
- 3D preview
- 3 test faces
- correction controls
- approve/reject

`DEFERRED / EXTERNAL INPUT REQUIRED`: the strict local review/evidence boundary is implemented, but this UI is not
considered complete until it operates on rights-cleared source images, three rights-cleared test-face sets, and an
authorized human approve/reject workflow. Synthetic placeholder media must not be used to claim D2 completion.

### D3 Processing Worker

- `GenerationJob` request/event v1 rejects unknown fields and binds tenant/model,
  method, generator identity/version/config digest, sorted source digests,
  measurement digest, generator-input digest, explicit timestamps, and retry
  policy. Processing identity excludes submission time/retry policy so identical
  immutable work has one deterministic SHA-256/idempotency key.
- Current state is derived only by replaying canonical SHA-256 chained events.
  Missing, reordered, duplicate, altered, cross-identity, stale, or future
  evidence fails closed against an explicit `evaluatedAt`.
- Only queued can be claimed. Claim attempts increase monotonically and bind one
  worker/token to a maximum 15-minute lease. Exact expired evidence can recover
  to queued without permitting two owners.
- Retry requires the current explicitly retryable failure and attempts below
  `maxAttempts`. Completed/cancelled histories are immutable. Review completion
  repeats exact immutable manifest/model hashes and byte lengths.
- The local Frame Factory adapter performs symlink-safe contained, atomic,
  no-overwrite writes of canonical digest-bound event bytes into one exclusive
  slot per sequence. Competing events from one head cannot both publish. It performs no
  network, Supabase, R2, Cloudflare, approval, publication, or Worker execution.
- Proxy manifest/GLB evidence may move a running job only to review. It does not
  grant approval/publication/live authority or G1/G2/G3 progress.
- The local Processing Worker v0 accepts only `method=proxy-auto`. Before claim,
  it parses and canonically hashes the complete strict Proxy input and binds its
  tenant/model, immutable source set, measurement identity, and generator
  id/version/config to the queued request. Standard, manual, and external work
  fail closed at this application boundary.
- Private authored Proxy execution reuses that same worker through
  `frame:worker:proxy-private`. Its input is a bounded, no-follow,
  private-root-relative ADR-0027 wrapper; the wrapper is strictly recomputed
  before claim. Output is staged as complete synced `0600` inodes and published
  by exclusive atomic no-replace links. Exact retry reuse requires both bytes
  and modes to match; permissive, partial, symlinked, or different output is a
  collision. The receipt contains no candidate path, filename, identity, or
  hash (ADR-0028).
- Private authored Proxy submission is a preceding, separate transaction. It
  accepts only the verified ADR-0027 wrapper locator, private ledger locator,
  bounded retry policy, and creation time; derives the strict request and queued
  event internally; and appends sequence one through the immutable ledger CAS.
  It never claims or processes, so the Loop29 worker remains the sole consumer
  (ADR-0029).
- The explicit synchronous timeline is also a pre-claim policy: claim time must
  precede both result timestamps, result timestamps must not exceed
  `evaluatedAt`, and `evaluatedAt` must be strictly earlier than lease expiry.
  A newly proposed claim already expired at the observation horizon is rejected
  before sequence CAS even when its backdated result events would replay.
- After winning the existing atomic sequence CAS, it writes only below an
  explicit symlink/traversal-safe local root. It independently rereads manifest
  and GLB bytes, computes actual SHA-256 and byte lengths, verifies URL/source/
  generator/candidate identity and fixed fixture/draft/proxy/non-live authority,
  then applies the shared runtime-compatible GLB validator before appending only
  `output-recorded` and returning review.
- Deterministic malformed/tampered/identity/config/output failures are terminal.
  Clean local I/O failures and output-record I/O are retryable only when no
  invocation-created partial remains and immutable complete bytes can be safely
  reused. Claim CAS loss occurs before ownership and creates no failure event.
  The Worker never blindly retries.
- Root and path-policy failures retain sanitized `ROOT_INVALID` /
  `OUTPUT_CONTAINMENT` classification instead of being relabelled as input
  identity failures. Required actual-byte rereads use no-follow handles;
  missing, symlink-swapped, or non-regular invocation output is terminal output
  validation and triggers cleanup proof for only invocation-created paths.
- A claim-link operation that reports failure is never assumed unpublished. The
  worker rereads the ledger: an exact claim head continues, an unchanged prior
  head is a proven append-I/O failure, a different valid head is contention, and
  an unreadable outcome returns explicit `recoveryRequired` without output work.

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

実装境界：

- `packages/widget-host`のparent adapterはDOM/windowをport化し、exact HTTPS widget URL/
  origin/path containment、sandbox=`allow-scripts allow-same-origin`、origin-scoped camera
  allow、exact source/origin/tenant/session/request/reply、replay/collision/stale lifecycleを検証する。
- reciprocal widget bridgeもexact parent window/originと同じbinding/stateを検証する。
- SKU changeはprotocolだけを通し、iframe URL mutationやcross-frame DOM操作を使わない。
- 親/widget CSP、Permissions-Policy、camera ownershipとcamera-free fixtureは
  `docs/11_HOSTED_WIDGET_EMBED_SECURITY.md`に定義する。これはproduction header/live EC
  evidenceではない。
- signed embed token/API key/auth、analytics backend、production delivery、live EC/camera
  permission evidenceはdeferredであり、E1 local protocol sliceからgateをpromotionしない。

### E2 Catalog Integration

- SKU lookup
- variant fallback
- unavailable request logging
- prefetch first asset

実装境界：

- `packages/contracts/src/catalogIntegration.ts` はtenant/site/production、request、
  SKU/model/variant、`none | explicit-same-model` fallbackをunknownからexact parseする。
- `packages/runtime/src/catalogSelection.ts` はcatalog entryと署名検証済みactive
  Deploymentだけを入力にするpure evaluatorである。exact SKUが存在する場合はfallbackせず、
  missing SKUのexplicit fallbackも同一tenant/model内かつDeployment認可済みexact targetだけを許す。
- `apps/try-on-web/src/runtimeCatalogIntegration.ts` はgeneric loaderをauthorityにせず、
  `loadDeployedRuntimeAsset`だけへ接続する。unavailable sinkはclosed event/reason codeだけを
  受け、observer failureはprimary fail-closed resultへ影響しない。
- first-asset prefetchは最大1 key、AbortSignal対応で、same-key concurrency/loadは同じ
  verified bytes promiseを再利用する。catalog/manifest/GLBは1 MiB/256 KiB/32 MiB上限、
  credentials omit/no-store/no-referrer、redirect後origin再検証を適用する。
- semantic cache keyはrequestIdを除きtenant/site/environment/SKU/model/variant/fallbackを
  含む。consumer cancelはshared prefetchをabortせず`REQUEST_CANCELLED`を返し、failure eventは
  consumer自身のrequestIdへ再相関する。
- `prefetchFirst`が返すhandleはsame-key secondaryを含めshared speculative operationのownerで、
  いずれの`handle.cancel()`も全prefetch ownerの共有operationをcancelする。`load` signalだけが
  non-owning consumer-local cancelである。
- verified Deploymentは`min(expiresAt, issuedAt + maximumDocumentAgeMs)` deadlineを返す。
  cache hitは`now < deadline`だけを許し、exact deadline以後は全chainをrefetch/reverifyする。
  envelopeもContent-Length不在を含め256 KiB streaming boundとbody cancel/releaseを持つ。
- catalog/manifest/envelope/Deploymentの全recordはplain data descriptorだけを許し、getter/
  symbol/custom prototype/hostile arrayをdereference前に拒否する。
- host deployment originsはnon-empty exact canonical HTTPS originのみで、全resource/redirect
  URLはcredentialを禁止する。Response後のnon-ok/origin/credential/declared-size拒否は
  unread bodyをbest-effort cancelしてから既存のstable classificationを返す。
- これはport/fake-fetchによるlocal evidenceであり、browser/CDN/network timing、production
  telemetry、real commerce integration、deployment operationを証明しない（ADR-0018）。

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

実装境界：

- `packages/contracts/src/commerceEvents.ts` はschema v1 closed unionを`unknown`からparseし、
  tenant/site/environment/session/event/request、1..256 sequence、millisecond UTC time、商品eventの
  SKU/model/variant/asset version/deployment/catalog/manifest/model digestをexactに束縛する。
- `packages/commerce-events` のpure reducerはreplay/reorder/cross-binding、impossible transition、
  permission/start順序、active前capture/cart、implicit product relabel、terminal後eventを拒否する。
- WidgetProtocolのbounded local `captureRef`もcommerce eventへは転記しない。capture occurrence
  だけを残し、frame/image/landmark/pose/scale/biometric、raw bytes/URL、secret/path/stack、raw error
  text、free-form propertiesをschemaに持たない。
- batch portはevent 8,192 bytes、1..32 event、exact final canonical envelope 32,768 bytes、
  5,000 ms timeout、AbortSignalを持つ。fixed-length placeholderでbyteLengthをsettleし、full
  batch-body SHA-256から`batchSha256`/idempotency keyを導出する。
- `priorBatchSha256`とledger stateを必須とするcross-batch evaluatorが全eventをlifecycle reducerへ
  replayする。parser単体はlifecycle evidenceではなく、dispatchはevaluate済みbatchだけをsinkへ渡す。
- pure evaluatorのstructural stateは保持するが、public dispatchはmodule-private WeakMapで発行した
  opaque ledgerだけを受ける。plain/forged lifecycle stateはprior digestが正しくてもsink前に拒否する。
  ledgerはprivate idle/in-flight/consumed状態を持ち、同時送信とaccept済みcapabilityの再利用をsink前に
  拒否する。retryable/abort/preflight failureだけが同じledgerを再試行可能状態へ戻す。
- sink responseはunknown hostile inputとしてdescriptor/prototype/symbol/unknown fieldを検証し、
  sink/timeout clock exceptionをserializeもthrowもしない。
- `createParentWidgetCommerceObserver` と `createCatalogUnavailableCommerceSink` だけがE1/E2を
  接続する。両adapterは再parse/binding/replay評価を行い、observer failureをprimary behaviorから隔離する。
- Supabase migration/remote writeは追加しない。fake/local sinkはproduction telemetry、consent、
  analytics、commerce evidenceではなく、G1/G2/G3/G4をpromotionしない（ADR-0019）。
- `apps/try-on-web/src/commerceAttribution.ts` はpublic-live loaderのprivate object-identity proofを
  持つexact `VerifiedRuntimeAsset`だけをregistryへ登録する。structural clone、QA/calibration、
  unregistered/mismatched assetはproduction attributionを作れない。arbitrary resolverは明示的な
  local/test portに限定する。
- production registryはexact bounded tenant/site/production scopeを所有し、proof登録、resolve、
  session factoryを同一scopeへ固定する。cross-tenant/site/stagingとsession/registry mismatchは拒否する。

### E4 Static/Low-Vision UX

度入りは販売しないが、眼鏡を外すと画面が見えにくい利用者は存在する。

- large controls
- countdown capture
- optional audio cue
- still-result review after putting glasses back on
- existing-glasses overlay modeは研究扱い

Local preparation contract：

- `packages/low-vision-ux` owns a DOM-free pure state reducer/controller. Unknown capture
  results and serialized state are exact plain-data validated before dereference; getters,
  symbols, custom prototypes, unknown fields, invalid phase/countdown/failure combinations,
  non-local references, and non-capability review objects fail closed.
- Countdown is exact 3→2→1 with 1,000 ms injected timer steps. Each callback is generation-
  bound and one-shot; repeated, stale, synchronously reentrant, cancelled, hidden, and
  destroyed callbacks cannot capture. One countdown invokes the capture port at most once.
- Capture accepts an AbortSignal and returns a local capability. Camera loss, cancel, page
  hide, close, destroy, retake, and stale completion revoke/dispose the capability. Browser
  composition bounds both camera and overlay dimensions and holds the JPEG only behind a
  revocable Blob object URL; it does not persist or transmit it.
- Audio defaults disabled and is enabled only by a semantic user control. Playback rejection
  marks audio unavailable without blocking countdown or capture; autoplay is never assumed.
- Review uses a labelled modal dialog, local descriptive image, inert background, initial
  focus, focus restoration/fallback, Escape terminal close, retake, and explicit terminal
  close. Controls are native buttons with >=56 px targets, visible focus, live status/timer,
  no color-only failure meaning, contrast-safe tokens, reduced-motion, and forced-colors rules.
- E1 receives only a validated bounded local `captureRef`; the separate E3 occurrence callback
  receives no arguments. Observer failures do not alter review. State serialization contains
  only phase/countdown/audio/reduced-motion/closed failure code and no free-form properties.

Gate remains `G4_SELF_EC_BETA_PASS`. These DOM/static and fake-port tests are local preparation,
not browser, assistive-technology, device, production telemetry, physical, or accessibility-
certification evidence. Existing-glasses overlay remains research-only and is not implemented.

---

## Wave F：100→500 Scale

### F1 Demand Queue

- unavailable try-on request count
- sales rank
- continuous-stock flag
- shape coverage

Local preparation contract/core (`f1-local-v1`):

- exact schema-v1 evidence/sales/inventory/coverage/build/command contracts; tenant/site/
  production and resolved SKU/model/variant/shape or explicit unresolved candidate identity
- E2 qualifying unavailable reasons and E3 recoverable `CATALOG_UNAVAILABLE`/
  `ASSET_UNAVAILABLE` only; shared request correlation makes the adapters alternative signals
- 30-day inclusive demand window; 24-hour rank, 1-hour inventory, and 7-day coverage inclusive freshness
- exact replay deduplication, correlation deduplication, scope-wide SKU/variant/candidate anti-relabel,
  latest-snapshot selection, and same-time conflict rejection
- metric validity is contract parsing; queue eligibility separately requires fresh continuous in-stock
  inventory; operational readiness separately remains local-only and G5 false
- deterministic priority `demand × 1000 + rank(0..100) + underrepresented shape(25)`, then oldest
  demand and canonical target identity; missing/stale rank or coverage earns no invented bonus
- evidence/sample batch maximum 1,000, queue maximum 500, command maximum 512 KiB; capacity exclusion
  is explicit and does not relabel eligibility
- deep normalized command reparse, canonical SHA-256/output idempotency, strict accepted/idempotent
  write acknowledgement, and contained clock/read/build/write failure
- command digest intentionally identifies equivalent operational output, not raw source provenance;
  production ingestion must retain authoritative source evidence separately

This slice has no SQL, Supabase, remote, physical-asset, or production queue mutation. Real sales,
inventory, representative catalog, operations, human effort, and G5 evidence remain external.

### F2 Batch Capture

- `packages/contracts/src/batchCapture.ts` owns the strict versioned event union, bounded catalog
  identity/classification, stable issue codes, and pure replay state machine.
- `packages/batch-capture` is the outer application boundary. It alone issues unforgeable
  object-identity capabilities for bounded local-private raw references and appends authorized
  capture events; contracts/core do not depend on filesystem, camera, network, Supabase, or R2.
- Every event binds tenant/site/production/operator-session/batch and monotonic sequence/time.
  Item binding fixes SKU/model/variant plus closed operator type/variant classification. SKU,
  item, variant, capture, capability, and local-reference identities cannot be replayed or relabelled.
- One model may intentionally own several variants. A variant cannot move between SKU/model identities,
  model product type cannot drift, and at most one tuple per model is `model-primary`, matching E2/F1
  anti-relabel semantics without treating an F1 priority command as capture authority.
- Raw bytes never enter these contracts or committed fixtures. Only `localraw:` opaque references are
  durable; URL/path/data-URL shaped values fail closed. Capability expiry is inclusive at its exact
  boundary, uses the event timestamp's supported range, failures including final replay/budget rejection
  do not consume a valid grant, and a successful grant is one-shot.
- `retake` never advances. `accept` and `reject` are distinct terminal item outcomes retained in replayed
  completed state; completion requires every expected item to have a terminal decision and advance.
- Event retry is idempotent only when the already-appended event ID and full canonical event match.
  Unknown/accessor/symbol/prototype/cycle/sparse/oversize/stale/reordered input fails closed.
- Budgets: 100 items, 1,000 events, 1 MiB canonical log, 16 sorted unique closed issue codes.
  Completion records `local-preparation-only` and `g5Ready:false` (ADR-0022).

No raw upload, camera/device adapter, filesystem store, remote write, public publication, or analytics
adapter is implemented by this slice. It creates no physical/rights/actual-wear/device/operations or
G1/G2/G5 evidence.

### F3 Review Operations

- `packages/contracts/src/reviewOperations.ts` owns strict v1 candidate-bound work items, hashed evidence,
  bounded full evidence chains, queue inputs/items, and canonical commands. All upstream hashes are labelled
  `candidate-references-unverified`; the binder supplies integrity, not upstream authentication.
- `packages/review-operations/src/core.ts` groups exact work/evidence identity and applies the contract-owned
  pure chain reducer. `packages/review-operations/src/index.ts` contains only optional local clock/read/write ports.
- Every binding fixes tenant/site/production, SKU/model/variant, GenerationJob and reviewed input/output candidates,
  asset/version candidate, policy, source/capture digests, and nullable F1/F2 digest candidates. No F1/F2 payload,
  `localraw:`, raw/media/path/URL, people/session/camera/biometric, notes, commerce, or analytics data is accepted.
- Closed outcome precedence is rejected > manual-required > correction-required > auto-review-candidate. Reasons
  are closed/sorted, correction attempts are 0..3, exhaustion routes to manual, and terminal outcomes cannot append.
- Evidence fixes `evaluationAuthority=local-candidate-unverified`; evaluator identity/version and findings remain
  unauthenticated candidate labels. Exported finding/reason/outcome allowlists are runtime-frozen tuples.
- Auto-candidate is routing only. Every command explicitly denies QA approval, AssetVersion promotion,
  `recommendedForLive`, deployment, publication, and G1/G2/G5 evidence.
- Durable queue parsing replays the entire maximum-four-event chain and checks hash/previous digest, sequence,
  correction attempt, binding, monotonic time, 24-hour inclusive freshness, terminal state, derived outcome/reasons,
  severity, global identity maps, and deterministic order. Exact retry is adjacent-only.
- Maximum 200 work items and 512 KiB canonical command. Unknown/accessor/symbol/prototype/cycle/sparse/oversize,
  duplicate/relabelled, orphan/reordered/stale/future, redigested escalation, and async TOCTOU input fails closed.
- Output remains `local-preparation-only` and `g5Ready:false`; no SQL/Supabase/R2/network/publication/remote adapter,
  human-review authority, physical/image/device/rights/actual-wear evidence, or G5 progress is created (ADR-0023).

### F4 Reprocessing

- `packages/contracts/src/reprocessing.ts` owns strict request/event/plan/command parsing and the trusted pure
  reducer; `packages/reprocessing/src/index.ts` only creates/appends local events and builds canonical commands.
- Regeneration is a one-attempt digest-reference candidate with `rawMaterialAuthority=false`; no raw reader or
  execution adapter exists. A retry is a new immutable request/generation identity.
- Previous/new identities remain distinct. Complete closed metrics derive better/equivalent/worse; absent or
  partial evidence is manual-required.
- Canary is exact-SKU, 1..2,500 basis points, 1..1,440 minutes and explicitly awaits later human/control-plane
  authority. Rollback binds only the exact older unverified reference and is manual-required, never automatic.
- The full maximum-five-event chain is embedded and independently replayed by the durable command parser.
  No SQL/Supabase/R2/network/filesystem/raw store/publication adapter or authority is present (ADR-0024).

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

### G1 External Service Readiness local preparation

- `packages/contracts/src/serviceReadiness.ts` owns the strict profile, usage event, deterministic evaluator, and
  canonical command parser; `packages/service-readiness/src/index.ts` only appends replay-validated local events
  and builds/verifies commands.
- The profile binds exact tenant/site/production, distinct parent/widget canonical HTTPS origins, contained widget
  path/URL, and exact catalog/asset origins. Derived requirements reuse WidgetProtocol v1 and E1 CSP/camera rules.
- All external prerequisites are fixed `pending-external`; the meter is a closed three-unit, one-occurrence,
  256-event/24-hour non-billable local ledger. No pricing, auth, SLA, legal policy, production port, or persistence
  is introduced.
- Commands independently replay the ledger and fix `local-preparation-only`, `g6Ready=false`, and all service,
  production, billing, legal, support, onboarding, and G1/G2/G5/G6 authority false (ADR-0025).

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
- `JSC-0205B` inspected-source candidate draft authoring and machine-success execution
- `JSC-0205C` private CaptureDraft-to-Proxy input authoring transaction and verified generator handoff
- `JSC-0207` catalog/manifest/GLB actual-byte integrity boundary
- `JSC-0208` deterministic tracking quality and runtime admission
- `JSC-0209` Ground Truth evidence/promotion profiles
- `JSC-0210` signed active Deployment proof and production catalog selection

### 次の外部入力・実機証跡

- `JSC-0205` J1-M measurements, source photos, and approved asset package
- `JSC-0206` first consented actual-wear Ground Truth fixture and report
- iPhone Safari and Android Chrome live-camera/device runs

### 次の設計補助

- [x] `JSC-0301` representative 20 strict inventory/coverage tooling; real selection, rights, sources, and measurements remain external
- [x] `JSC-0302` capture jig specification/readiness tooling; physical calibration remains external
- [x] `JSC-0303` generation bakeoff contract/evaluator/protocol; all real 43-cell evidence (Proxy/Standard × 20 plus 3 Premium baselines) and strategy selection remain external

These completions prepare G2 tooling only. They do not make G2 ACTIVE/PASS and do not change the active G1 physical-evidence blockers.

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
## JSC-0218 persistence decomposition

1. Snapshot the entire raw JSC-0215 request and host context synchronously with
   exact-object, descriptor, cycle, depth, node, text, and byte budgets.
2. Re-evaluate JSC-0215 against host trust; bind tenant/model/variant, current
   GenerationJob head/output, sorted unique source hash-to-ID map, verified
   MeasurementSet, reviewer authority, bounded `maximumReviewAgeMs`, its policy
   digest, exactly derived freshness/effective horizons, and unused candidate.
3. Derive domain-separated terminal, authority, asset, binding, source-row, and
   plan identities. Exact retries reproduce bytes; same identity/different bytes
   is denied. Host `evaluatedAt` is not a stable identity input.
4. Project reject as terminal record only; project approve as the same complete
   record plus an exact internal-review-only AssetVersion, binding, and sources.
5. A future writer re-runs steps 1-4 from raw input. The exported plan inspector
   is semantic/integrity-only and cannot authorize persistence from an embedded
   self-signed key.
6. PostgreSQL enforces append-only rows, exact relational links, current-head and
   active-authority locking/rechecks, global standard/premium approve binding,
   and permanent internal publication/live denial. SQL does not verify ES256 or
   canonical hashes. See ADR-0037.

## JSC-0218A writer decomposition

1. Synchronously snapshot the complete hostile raw JSC-0215 request under the
   existing descriptor/key/text/byte/node/depth/width budgets before any await.
   Authenticate opaque actor/request identity before `BEGIN`; reject accessors,
   symbols, polluted prototypes, cycles, sparse arrays, oversized values, and
   post-call mutation without invoking caller code.
2. Snapshot/freeze the returned host trust context before the next await. Check
   out one exclusive pinned physical session, acquire bounded session advisory
   locks for job/head, authority/key, and candidate in canonical order before
   `BEGIN` or any snapshot-producing statement, then open one SERIALIZABLE
   transaction and use its single
   `transaction_timestamp()` as `observedAt`/`evaluatedAt`. Derive the control
   snapshot solely from strict-parsed database results: canonical job ledger
   output and current head, active reviewer authority, unambiguous exact
   tenant/model/variant sources, verified same-specimen MeasurementSet, and
   complete asset/review/binding collision state. Compare every stored job
   method/generator/config/measurement/source/max-attempt/creation/identity fact
   with the replayed genesis request and selection.
3. Read in deterministic order: GenerationJob, current output head, authority,
   MeasurementSet, sorted sources, then terminal heads. Generation-event and
   authority mutation triggers plus review/internal-asset/binding/source/approval
   validators acquire the applicable authority -> candidate -> job advisory
   subset before authoritative reads. Locator reads may obtain immutable IDs
   only, followed by authoritative reread under lock. Candidate
   terminal identity is GenerationJob-independent. Re-run
   `evaluateNonProxyQaPersistencePlan` with private host trust and the freshly
   derived snapshot. Consume only its in-memory projections; never accept a
   serialized plan, caller snapshot/JWK/clock/SQL, or integrity-inspector result.
4. Reviewer-authority registration is an external trust-administration step;
   this writer only locks and rereads one pre-existing exact active authority.
   For reject, insert only the terminal-review fact. For approve, insert the
   terminal review, AssetVersion in `review` with internal-only
   rights, sorted sources, and binding, then perform the approved transition.
   Parameter values cross only the typed port; none become SQL text or identifiers.
5. Reconstruct and compare every canonical field on exact retry and post-write
   reread, reconstruct the signed payload with the shared helper, and verify its
   signature again. Snapshot/freeze each hostile driver result immediately in
   the query continuation under one aggregate transaction budget. After receipt
   hashing, fault hooks, and all other awaits, use `clock_timestamp()` at the
   final precommit boundary to recheck head, active authority, and expiry. Any partial/different/unreadable state or
   mismatch rolls back and grants nothing.
6. Release known session locks in reverse order on success, denial, cancellation,
   timeout, transaction error, and commit-ack ambiguity. A lock-query rejection
   has unknown acquisition outcome and therefore destroys the lease after known
   unlock attempts. Unlock/reset failure and unknown BEGIN/COMMIT/ROLLBACK also
   destroy it. `discard()` waits for a real close/destroy attempt and a pool never
   repools it, even if close rejects. The transaction provider rolls back a
   rejected callback before returning it. After callback completion, every non-
   conflict host/port/check-in rejection is commit-ambiguous and exact recovery
   checks out a fresh lease. Run mutation and read-only recovery through the same
   transaction-boundary tracker; unknown recovery `BEGIN`, lost recovery
   `COMMIT` ACK, callback error replaced by a distinct rollback/provider error,
   and post-callback failure destroy the lease. Only the exact callback error
   returned after confirmed rollback may preserve it. Retry lock timeout,
   serialization, and deadlock failures within a fixed budget using only the
   initial immutable raw snapshot and a fresh transaction/time/evaluation.
   Cancellation before confirmed commit rolls back. Treat lost commit acknowledgement
   as unknown; only independent exact verification may return
   `recovered-exact-commit`, otherwise return `COMMIT_OUTCOME_UNPROVEN`.
7. Return one deeply frozen bounded receipt containing only canonical IDs,
   digests, decision, committed time, and `inserted | exact-retry |
   recovered-exact-commit`. Redact SQL and sensitive diagnostics, and keep every
   preview/runtime/publication/deployment/catalog/public and G1-G7 authority false.
8. The v3 migration adds the minimum trusted output/specimen identity support and
   one credentialless `NOBYPASSRLS` exact-grant writer group role. Forced RLS has
   explicit writer policies on exactly nine SELECT, four INSERT, and one UPDATE
   relation/command surfaces. The pre-existing 19 authenticated member-read
   policies and authenticated `private.is_tenant_member(text)` EXECUTE remain;
   no new API mutation surface is added. Role-aware invoker triggers
   deny ordinary drafts, unrelated transitions, and arbitrary review/source/
   binding rows; new/replaced writer-path helper EXECUTE is revoked from
   PUBLIC/API/writer.
   Each transaction fixes `search_path` and bounded lock/statement/idle timeouts.
   The role is trusted server TCB infrastructure, not a DB-side ES256 verifier;
   compromise of a future production login/membership loses this authority.
   Verify v1 -> v2 -> v3,
   forced RLS/exact policies, catalog grants/denials, rollback, concurrency,
   readback, fault, and commit-ambiguity behavior through the real local adapter.
   Deep-snapshot exact validator advisory operands/seed and relevant enabled
   `BEFORE ... FOR EACH ROW` validator/guard trigger definitions/functions.
   Select pinned `node-postgres` `pg.PoolClient` as the production lease: one
   `pool.connect()` checkout owns the entire session-lock/transaction/cleanup
   sequence, `pool.query()` is forbidden there, and ambiguous cleanup destroys
   rather than repools the client. JSC-0220 later verifies this provider on a
   PostgreSQL 17.11 Linux CI service with distinct backend PIDs, actual lock
   ordering/blocking, exact expiry, statement-timeout rollback, discard, and
   fresh-connection recovery. PGlite remains complementary and is not real
   pooled-session evidence.
   See ADR-0038.
