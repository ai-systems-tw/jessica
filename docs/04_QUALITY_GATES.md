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

### JSC-0301–0303 G2 preparation reports

The implemented G2 evaluator keeps five states separate: strict document validity, 43-cell internal evidence completeness, calculated gate metrics, stop signals, and `G2_GENERATION_STRATEGY_SELECTED` readiness. Gate boundaries are inclusive: `auto >= 50%`, Standard correction median `<= 10 minutes`, and manual share `<= 25%`. Stop signals remain independently strict: any Standard correction `> 15 minutes`, manual share `> 25%`, or measured mobile performance `< 20 fps`.

The representative inventory has one tenant, exactly 20 distinct FrameModels, and covers acetate/cell, metal, brow, transparent, sunglasses, small, large, high-curve, and rimless, with honest overlap allowed. Coverage does not imply rights or capture readiness. Proxy and Standard are required for all 20; Premium is required only for exactly three declared difficult baseline models, totaling 43 internal cells. Commercial Reference is optional. Every required run uses a supported mobile device class. Templates/synthetic fixtures can validate contracts but cannot select a strategy or activate/pass G2.

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

### Active Deployment regression (`JSC-0210`)

- generic loaderとplain structural objectは`public-live` capabilityにならない
- host固定 `keyId → authorityId + P-256 public JWK` でES256 envelopeのexact payload bytesをparse前に検証する
- tenant/site/environment streamごとにactive pointerはexact 1で、SKU/model/variant/asset id+versionとcatalog/manifest/model actual-byte hashesを終端まで束縛する
- host deployment/catalog origin allowlistとsigned `allowedOrigin`を交差し、HTTPSとredirect後originを再検証する
- revision/generationは共にstrict monotonic、rollbackは新revisionで行い、prior pointerは直前document SHA-256を含むreceipt全体と一致する
- Web Locks + re-read CAS receipt storeをpublic-live必須とし、receiptなしのephemeral production pathを持たない
- issued/activated/expires、host minimum floor、maximum signed lifetime/age、envelope/payload byte上限をfail-closed評価する
- query由来key/hash/SKU/catalog pin、payload/signature/key/alg改ざん、catalog substitution、cross-tenant/SKU/identity/hash、duplicate active、broken chain、stale/future/overlong document、origin escapeをnegative fixtureで拒否する
- catalog、manifest、GLBを各1回だけ取得し、rendererへexact verified GLB ArrayBufferを渡す

新規browserのreplay耐性はhost minimum floor、署名付きexpiry、maximum age/lifetimeでboundedされる。外部online freshness authorityや共有server CASなしにabsolute replay preventionを合格条件として主張しない。

### Runtime tracking policy regression (`JSC-0208`)

- landmark visibilityをconfidenceに使用しない
- 完全性/有限性、in-frame、pixel span、時間残差、transform jumpから決定論的な非二値confidenceを得る
- normalized quaternion YXZをidentity、各軸±、combined、q/-q、nonunit、invalid、gimbal近傍で検証する
- raw yaw/pitch、minimum scale confidence、mm-per-pixel availabilityをfilter前に判定する
- no-face/moderate-lowの249/250、短いdip、exit回復、enter再取得holdをfake clockで検証する
- no-frame/pending detect、dispose/restart、queued stale timerで旧世代が新sessionを隠さない
- public-live/qa-preview/calibration拒否時にGLB modelを取得せずfail-closedとなる

watchdogのwall-clock評価はbrowser event loopが進行する条件で行う。main-thread同期占有のpreemptionはWorker化後の別ゲートとする。

### Tracking Worker regression

- protocol/version/unknown field/message kind、handshake、init failure/timeoutをfail closedにする
- public-liveはWorker/transfer非対応時にin-process fallbackしない
- classic bootstrapがES-module listener準備前のinitを順序どおりbuffer/replayし、MediaPipe 1.0.1 WASM loaderをWorker内で初期化できることをreal-browserで検証する
- vision module/WASM/model/Worker URLをsame originへ固定し、model actual bytesのlength/hashとredirectを検証する
- inference最大1 + latest queue最大1、drop policy、bitmap生成完了順によるtimestamp逆転防止を検証する
- post前main ownership、post後Worker ownership、success/no-face/error/timeout/stale/dispose/restart/malformed messageでcloseまたはtermination releaseを検証する
- resultの478 landmarks、finite値、4x4 transform、quality diagnosticsをuntrusted plain dataとして全面検証する
- pending Workerの249/250 ms visibility、late result/error suppression、inference timeout terminate/restart、stale generation/timerをfake clock/Workerで検証する
- window Resource Timingに依存せずconfigured Worker resourcesとWorker-side originsを含めてexternal requestをauditする

Worker stallからの250 ms hideはUI event loopが進行する条件で保証する。別のsame-thread timerはUI event-loop自体のstallをabsolute preemptできない。

Golden images may support review, but must not be the only quality signal.
