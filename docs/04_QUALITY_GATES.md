# Jessica Quality Gates

## 1. 原則

- 見た目だけで合否を決めない。
- 数値だけで商用品質を決めない。
- 自動指標と眼鏡店レビューを両方通す。
- thresholdはfixtureと端末を固定して比較する。

## 2. Ground Truth fixture

各fixtureは次を含む。

```text
fixture id
person id (pseudonymous)
frame model id
source image/video hash
actual frame measurements
capture distance/lighting metadata
manual annotations
expected viewing angle
```

画像・映像の利用同意と保存範囲を明示する。

### JSC-0209 evidence profiles

- `TECHNICAL_SINGLE_FRAME_SLICE_READINESS`: 1 fixtureのtooling/metric readiness。G1/canonical PASSではない。
- `G1_CANONICAL_VALIDATION`: exact 3 subjects × 5 distinct frame models × 3 views = 45 unique cellsに加え、5 device classes、visual、consent、integrity、3/10分performance/operational evidenceが全て必要。

`metricPass`は各fixtureの数値閾値だけを表し、`gateReady`は全evidence/coverageを含む。中央値が良くてもper-fixture違反を隠してpromotionしない。`canonicalPromotionReady`はcanonical profile以外では常にfalse。raw actual-wear mediaはGitへ置かず、actual-bytes SHA-256 verification metadataと外部保管provenanceだけを扱う。詳細はADR-0007。

## 3. Placement metrics

- `bridgeErrorMm`
- `frameWidthErrorPct`
- `leftLensCenterErrorMm`
- `rightLensCenterErrorMm`
- `rollErrorDeg`
- `yawAttachmentErrorMm`

## 4. Temporal metrics

- translation jitter RMS mm
- rotation jitter RMS deg
- motion lag ms
- reacquire jump mm
- lost-state latency ms

traceはmotion、loss後のhide、reacquisitionを実際に含まなければならず、未観測事象を0として合格させない。translation jitterはtarget-overlay residual vectorの平均からのRMS変動、rotation jitterは円周平均からのRMS変動とする。

## 5. Performance metrics

- initial runtime load ms
- first detection ms
- first rendered asset ms
- detection fps
- render fps
- memory peak
- 3/10 minute thermal behavior
- battery/CPU class where measurable

canonical device runは3分と10分の両checkpointを必須とし、sustained render FPS >= 24、detection FPS >= 15、frameCountとduration/FPSの整合、memory、thermalをfail-closed評価する。

## 6. Initial thresholds

These are starting targets and must be calibrated after the first real fixture set.

```text
median bridge/placement error <= 3 mm
frame width error within ±5%
static jitter RMS <= 0.75 mm
normal-condition tracking success >= 90%
mid-range mobile render >= 24 fps
low-confidence false attachment duration <= 250 ms
```

250 msは最初の`confidence < exitThreshold`のwall-clock時刻を起点とし、no-face (`0`) とmoderate-lowの双方に適用する。249 msでは非zero holdを許容できるが、250 ms境界ではopacity 0でなければならない。raw poseのQualityEnvelope違反とscale policy違反はholdを適用せず、同一frameでopacity 0とする。

## 7. Asset production thresholds

Representative 20:

```text
auto first-pass approval >= 50%
standard correction median <= 10 minutes
manual-model share <= 25%
```

Target after Factory stabilization:

```text
standard SKU human touch <= 15 minutes maximum
no source image loss
100% asset traceability to source hash and generator version
```

## 8. Visual review

Reviewer checks:

- nose placement
- apparent front width
- eye/lens relationship
- temple intersection
- floating appearance
- pantoscopic impression
- frame material impression
- sunglass tint misrepresentation
- size exaggeration

Result:

```text
approve
approve-with-envelope-limit
correction-required
manual-model-required
unsupported
```

## 9. Regression

Every runtime change must run:

- pure unit tests
- canonical tracking fixture
- canonical pose fixture
- placement report

### Runtime asset integrity regression (`JSC-0207`)

- manifest/GLBの実bytes SHA-256とbyteLengthが一致する
- catalog/manifestのidentity、source hashes、metre単位、boundsが一致する
- GLB v2 header/chunk、埋込BIN、POSITION実bytes、bufferView containmentを検証する
- required nodesが重複せずactive sceneから到達可能である
- live assetは`published`かつ`recommendedForLive=true`、draft proxyは明示fixtureだけである
- catalog/manifest/modelのabsolute URLとredirectがallowlistを逃げない
- 検証済みbytesをrendererが再fetchせず使用する
- 2商品catalog fixtureから追加SKUをコード変更なしで選択できる

hash、header、unit、node、bounds、bufferView、origin、source provenanceの各改ざんnegative testをCIでfail-closed確認する。

### Runtime tracking policy regression (`JSC-0208`)

- landmark visibilityをconfidenceに使用しない
- 完全性/有限性、in-frame、pixel span、時間残差、transform jumpから決定論的な非二値confidenceを得る
- normalized quaternion YXZをidentity、各軸±、combined、q/-q、nonunit、invalid、gimbal近傍で検証する
- raw yaw/pitch、minimum scale confidence、mm-per-pixel availabilityをfilter前に判定する
- no-face/moderate-lowの249/250、短いdip、exit回復、enter再取得holdをfake clockで検証する
- no-frame/pending detect、dispose/restart、queued stale timerで旧世代が新sessionを隠さない
- public-live/qa-preview/calibration拒否時にGLB modelを取得せずfail-closedとなる

watchdogのwall-clock評価はbrowser event loopが進行する条件で行う。main-thread同期占有のpreemptionはWorker化後の別ゲートとする。

Golden images may support review, but must not be the only quality signal.
