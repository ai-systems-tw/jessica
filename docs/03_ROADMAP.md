# Jessica Gate-based Roadmap

Jessicaは期間ではなく、再現可能なゲートで進む。

## G0 — Foundation

### 目的

設計正本と、外部SDKに依存しない核を作る。

### Exit

- 大設計・分解設計・品質ゲートが存在
- mm/m契約がテスト済み
- FrameModel/Variant/AssetVersion契約が存在
- One Euro FilterとConfidenceGateがテスト済み
- Quality Harnessが決定論的に動く
- Camera shellが許可/拒否/停止を扱う

### 状態

`PASS`

---

## G1 — Single Frame Runtime

### 対象

J1-M 1本。

### 状態

`ACTIVE / browser vertical slice, exclusive runtime application coordinator, self-test, and signed Deployment integrity tooling pass; external production deployment authority, physical J1-M asset, actual-wear placement report, and live device evidence pending`

`JSC-0216_RUNTIME_APPLICATION_COORDINATOR` closes the code-level lifecycle bypass: verified
preflight precedes camera/backend/WebGL, the existing RuntimeLifecycle reducer drives the real app,
and generation-owned serialized teardown covers late promises, track end, page hide, context loss,
and restart. This is deterministic code evidence only; it does not add device/performance or physical
placement evidence and does not make G1 PASS.

`JSC-0217_CAMERA_PROJECTION_PROFILE` completes the code-level fail-closed projection boundary:
strict Deployment-bound production profiles, exact active-camera admission, one calibrated asymmetric
projection across pose/depth/render/capture, responsive viewport mapping, compositor-owned mirroring,
and in-inference source-drift teardown. It supplies no real camera profile/calibration artifact or residual,
five-device evidence, physical J1-M, exact-45 actual-wear evidence, or production authority/deployment;
those remain external blockers and G1 remains ACTIVE, not PASS.

### Exit

- 実機camera
- MediaPipe tracking
- PoseAdapter
- ScaleResolver
- filter/gate
- depth-only face mesh
- J1-M GLB
- 正面〜軽い斜めで自然
- Ground Truth report
- 顔データ外部送信なし

---

## G2 — 20 Frame Generation Bakeoff

### 対象

セル、メタル、ブロー、透明、サングラス、小型、大型、高カーブ、リムレス等を含む代表20本。

### Exit

- Proxy/Standard/Premiumの比較
- 自動一発承認率
- 平均修正時間
- 手動対象率
- 角度別品質
- モデル容量/性能
- 主力生成方式を決定

### 禁止

このゲート前に残り在庫を一括撮影しない。

---

## G3 — Frame Factory 25

### 状態

`NOT ACTIVE / local GenerationJob, Proxy Worker, and fail-closed QA-to-draft tooling are preparation only`

### Exit

- 開発者がJSONを書かず商品追加
- raw source保存
- generation job
- 3D/顔preview
- correction
- approve/reject
- immutable AssetVersion
- deployment/rollback
- 25商品をRuntimeで切替

---

## G4 — Self EC Beta 100

### 準備状態

`NOT ACTIVE / E1 hosted-widget, E2 deployed-catalog, E3 commerce-event, and E4 static/low-vision local ports/tests are preparation only; real commerce, consent, production telemetry, browser/CDN/network, assistive-technology, accessibility, and device evidence pending`

### Exit

- 自社商品ページにHosted Widget
- 100商品程度
- camera拒否fallback
- 商品切替/capture/cart request
- non-biometric analytics
- 実端末別成功率
- 試着開始と購入行動を計測

E4 local preparation adds deterministic 3-2-1 still capture, opt-in non-blocking audio,
local review, disposal/race handling, and static accessibility semantics. It provides no
physical asset, real camera/device, assistive-technology, production, or accessibility-
certification evidence and does not activate or pass G4.

---

## G5 — 500 Catalog Operational

### 準備状態

`NOT ACTIVE / F1 demand, F2 batch-capture, F3 review-operations, and F4 reprocessing strict local preparation only; authoritative upstream evidence, real operations, human/control-plane authority, raw material, and physical assets pending`

F1 local preparation fails closed on unknown/stale inventory and never invents demand, rank, stock,
or coverage. Its canonical command always carries `g5Ready:false`; it does not activate or pass G5.

F2 local preparation binds SKU/model/variant and operator-session/batch/item identities, requires a
closed quality decision before item advance, and records raw capture only through bounded opaque local
references plus an explicit one-shot capability. It performs no camera capture, raw upload, filesystem
write, remote mutation, or public/commerce/analytics emission. Completion remains
`local-preparation-only` with `g5Ready:false` and does not activate or pass G5.

F3 local preparation deterministically routes candidate-bound evidence to auto-review-candidate,
correction-required, manual-required, or rejected. All upstream hashes remain explicitly unverified candidates.
Auto-candidate is not approval, promotion, live recommendation, deployment, publication, or gate evidence.
Commands deny all such authority, remain `local-preparation-only` with `g5Ready:false`, and do not activate or pass G5.

F4 binds old/new version and generation identities and prepares only unverified digest-reference regeneration,
closed-metric comparison, bounded canary, and exact-prior rollback references. It performs no raw access, generation,
QA, promotion, Deployment/publication mutation, or automatic rollback. Commands remain `local-preparation-only`,
`g5Ready:false`, and do not activate or pass G5.

### Exit

- SKUと型の棚卸し完了
- 撮影/計測/生成/QAキュー運用
- demand-based priority
- 失敗分類
- regeneration/rollback
- 人間工数が許容範囲
- 全商品または明示的対象外を確定

---

## G6 — External Service Readiness

### 準備状態

`NOT ACTIVE / strict readiness-profile and privacy-safe non-billable usage-ledger local preparation only; all
authenticated tenant, signed onboarding, production header, legal/IP, sustained-operation, real-usage,
billing/pricing, and staffed-support authority remains pending external`

The G6 local candidate fixes exact tenant/site/production and HTTPS origin/embed requirements, replays at most 256
closed non-biometric usage occurrences over 24 hours, and denies every production/service/gate authority. It has no
production adapter and does not activate or pass G6 (ADR-0025).

### Exit

- 自社運用の継続実績
- tenant isolation
- hosted embed docs
- origin/CSP/camera requirements
- legal/IP review
- onboarding flow
- usage metering
- service menu and support boundary

---

## G7 — Fit Intelligence

### 準備状態

`NOT ACTIVE / G7-A strict product-size comparison and similar-size local candidate preparation only; calibrated
face/device evidence, validated policy, outcome semantics, real catalog operations, publication, personalization,
and production authority pending external`

G7-A compares only listed product millimetre measurements with a fixed non-production candidate policy. It makes
no personal suitability, physical, medical/biometric, causal-outcome, publication, or gate claim (ADR-0026).

### Exit

- relative size rules
- explanation
- similar-size recommendation
- outcome measurement
- no medical claims
