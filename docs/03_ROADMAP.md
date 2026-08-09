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

`ACTIVE / browser vertical slice and self-test pass; physical J1-M asset, actual-wear placement report, and live device evidence pending`

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

### Exit

- 自社商品ページにHosted Widget
- 100商品程度
- camera拒否fallback
- 商品切替/capture/cart request
- non-biometric analytics
- 実端末別成功率
- 試着開始と購入行動を計測

---

## G5 — 500 Catalog Operational

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

### Exit

- relative size rules
- explanation
- similar-size recommendation
- outcome measurement
- no medical claims
