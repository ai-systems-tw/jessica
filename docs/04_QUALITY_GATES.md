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

## 5. Performance metrics

- initial runtime load ms
- first detection ms
- first rendered asset ms
- detection fps
- render fps
- memory peak
- 3/10 minute thermal behavior
- battery/CPU class where measurable

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

Golden images may support review, but must not be the only quality signal.
