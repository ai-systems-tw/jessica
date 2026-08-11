# Jessica 大設計 v1.0

## 0. 文書の役割

本書は、Jessicaの製品境界、アーキテクチャ、品質原則、事業上の拡張方向を固定する正本である。

実装の細分化、依存関係、チケット、完了条件は `02_DECOMPOSITION_DESIGN.md` に定義する。開発日数ではなく、`03_ROADMAP.md` の品質ゲートを通過したときだけ次段階へ進む。

---

## 1. プロジェクト定義

### 1.1 名称

**Jessica**

### 1.2 一文での定義

Jessicaは、伊達眼鏡・サングラスをブラウザ上で仮想試着できるようにし、実物フレームの撮影・計測・3D資産化・品質確認・EC配信までを一体化する眼鏡デジタル化プラットフォームである。

### 1.3 作るもの

Jessicaは次の4領域から成る。

1. **Try-On Runtime**
   顔追跡、姿勢・縮尺推定、追跡安定化、オクルージョン、3D眼鏡描画、商品切替、失敗時UX。

2. **Frame Factory**
   撮影、実寸入力、形状生成、素材設定、プレビュー、人間レビュー、バージョン化、公開。

3. **Catalog & Delivery**
   型、色違い、販売SKU、生成物、公開版、API、R2/CDN配信、ECとの紐付け。

4. **Fit Intelligence**
   後段で追加する相対的なサイズ案内、類似サイズ商品の推薦、商品比較。

### 1.4 最初の顧客

最初の顧客は自社ECである。自社が実際に500本規模を登録・更新・販売に使用できることを外部提供より先に証明する。

### 1.5 将来の事業像

自社運用で鍛えたFrame FactoryとTry-On Runtimeを、将来は次の形で外部提供できるようにする。

- Digitize Only：眼鏡を試着可能な3D資産へ変換して納品
- Hosted VTO：埋め込み型試着Widgetと配信基盤を提供
- Managed Service：撮影・計測・3D化・EC連携を一括代行
- White-label/API：独自UIや外部ECから利用できるAPIを提供

外販は初期MVPの範囲外だが、後付けが高くつく `tenantId` とカタログ取得元の外部化だけは最初から組み込む。

---

## 2. 対象範囲

### 2.1 初期対象

- 伊達眼鏡
- サングラス
- 透明レンズ
- カラーレンズ
- ミラーレンズ
- セル、メタル、TR90、コンビネーション
- PCおよびスマートフォンの主要ブラウザ

### 2.2 初期非対象

- 度付きレンズの光学シミュレーション
- 医療・検眼・処方用途
- PDのユーザー向け正式測定機能
- 完全な物理フィット保証
- 髪の毛の高精度オクルージョン
- 現在かけている眼鏡の画像除去
- 全方向・全照明条件での完全追跡
- ネイティブアプリ

### 2.3 追跡品質に対する立場

Jessicaは「絶対に外れない追跡」を約束しない。

初期保証範囲は、正面から軽い斜めを中心とする。

- 左右回転：暫定 ±25度
- 上下回転：暫定 ±15度
- 首の傾き：暫定 ±20度
- 通常の室内照明
- 顔が十分な画素数で映る距離

保証範囲外や信頼度低下時は、誤った眼鏡表示を継続せず、薄くする、一時停止する、再姿勢を案内するなど、失敗を明示的に扱う。

---

## 3. 設計原則

### P1. 一つの3Dランタイム

2D、2.5D、3Dの別ランタイムは持たない。すべての試着資産をGLBとして扱う。

品質差はレンダラーの種類ではなく、資産品質として表現する。

- `proxy`
- `standard`
- `premium`

### P2. 品質ティアには保証範囲を持たせる

資産ごとに `QualityEnvelope` を持ち、どの角度まで推奨するか、ライブ試着に適するか、縮尺確信度はどの程度かを宣言する。

`QualityEnvelope.scaleConfidence` は資産が要求する**最低縮尺確信度**である。資産品質tier (`proxy` / `standard` / `premium`) は表現品質であり、それ単独ではlive可否を決めない。

低品質資産を高品質に見せかけない。

### P3. 顔処理は原則ブラウザ内

カメラ映像、顔ランドマーク、顔画像は原則としてサーバーへ送らない。

サーバーへ送るのは、SKU、試着開始、エラー区分、性能区分など、生体情報を含まないイベントだけとする。

### P4. 実寸と描画単位を分離する

- 管理画面・商品DB：mm
- glTF/GLBおよび描画空間：m

境界で明示的に変換し、暗黙の1000倍誤差を防止する。

### P5. Frame Factoryを初期から作る

試着エンジンだけを先に完成させ、後から500商品を手作業で登録する進め方は採らない。

10本を超える前に、最低限の登録・生成・プレビュー・補正・承認画面を作る。

### P6. 原画像を資産として保存する

背景除去後の画像だけでなく、圧縮・加工前の原画像、撮影条件、計測値、生成方式、生成バージョンを保存する。

将来アルゴリズムを改善した際に再撮影せず再生成できることを重視する。

### P7. 品質評価を先に作る

「なんとなく自然」を開発完了条件にしない。

実物着用写真と実測値をGround Truthとして、位置誤差、幅誤差、ジッター、追従、性能を再現可能に測る。

### P8. 期間ではなくゲートで進む

4週間、8週間といった日数は見積であり、完成条件ではない。

品質・性能・制作工数の客観条件を満たしたときだけ、次のゲートへ進む。

### P9. 自動生成率を仮定しない

シルエット押し出しやパラメトリック生成は有力な仮説だが、80〜90%成功を前提に500本へ展開しない。

代表20本で自動生成、一部手動、商用サービス参考結果を比較し、実測の承認率と修正時間で採否を決める。

### P10. 自社利用と外販の共通核を作る

外販向け請求・契約管理は後回しにするが、Runtime、Frame Factory、Catalog、品質評価は自社と外部で共通化する。

---

## 4. システム境界

```text
┌──────────────────────────────────────────┐
│ Frame Factory                            │
│ 撮影 → 計測 → 生成 → プレビュー → QA → 公開 │
└──────────────────────┬───────────────────┘
                       │ versioned asset
                       ▼
┌──────────────────────────────────────────┐
│ Catalog & Delivery                       │
│ 型 / 色違い / SKU / GLB / texture / API    │
└──────────────────────┬───────────────────┘
                       │ catalog + asset
                       ▼
┌──────────────────────────────────────────┐
│ Try-On Runtime                           │
│ camera → tracking → pose → scale → filter │
│       → depth occlusion → render → UX      │
└──────────────────────┬───────────────────┘
                       │ commerce event
                       ▼
┌──────────────────────────────────────────┐
│ 自社EC / 将来の外部EC                       │
│ 商品ページ / 商品切替 / カート遷移 / 分析       │
└──────────────────────────────────────────┘
```

---

## 5. Try-On Runtime 大設計

### 5.1 処理パイプライン

```text
getUserMedia
  ↓
Camera Session
  ↓
Worker boundary (classic SDK bootstrap + ES-module processing graph; transferable frame, one in flight + latest)
  ↓
FaceTrackingBackend / MediaPipe detectForVideo (Worker only in public-live)
  ↓
FaceTrackingResult
  ├─ landmarks
  ├─ facial transformation matrix
  ├─ confidence
  └─ timestamp
  ↓
TrackingQualityEstimator
  ├─ landmark completeness / finite values
  ├─ in-frame ratio / pixel span
  ├─ normalized temporal residual
  └─ transform rotation / translation jump
  ↓
PoseAdapter
  ├─ 座標系変換
  ├─ 前面カメラ反転補正
  ├─ video crop / aspect補正
  ├─ FOV補正
  └─ 鼻根基準への補正
  ↓
ScaleResolver
  ├─ 虹彩径の複数フレーム中央値
  ├─ 顔ランドマーク比率
  ├─ 端末/画角補正
  └─ 任意校正・手動微調整
  ↓
ConfidenceGate
  ├─ first below-exit instant retained
  └─ wall-clock visibility watchdog (maximum 250 ms)
  ↓
QualityEnvelope evaluator (raw pose + scale)
  ↓
TrackingFilters
  ├─ translation One Euro Filter
  └─ quaternion adaptive filter
  ↓
Renderer
  ├─ camera background
  ├─ depth-only face mesh
  ├─ eyewear GLB
  ├─ lens material
  └─ environment reflection
```

### 5.2 アダプター境界

MediaPipeをドメイン本体へ直接浸透させない。

`public-live`ではこのinterfaceの実装はversioned Worker hostに固定し、main threadから同期MediaPipe推論を呼ばない。MediaPipe Tasks Vision 1.0.1のWASM loader互換性のためsame-origin classic bootstrapを使うが、Jessica処理本体はES module graphである。Worker/transfer非対応時はfallbackせずfail closedとする。Worker内処理もbrowser-localであり、frame/landmark/transform/face dataをorigin外へ送らない。

```ts
interface FaceTrackingBackend {
  initialize(): Promise<void>;
  detect(frame: VideoFrameInput): Promise<FaceTrackingResult>;
  dispose(): Promise<void>;
}

interface PoseAdapter {
  resolve(input: FaceTrackingResult, camera: CameraCalibration): HeadPose;
}

interface ScaleResolver {
  update(input: ScaleObservation): ScaleEstimate;
}

interface EyewearRenderer {
  initialize(canvas: HTMLCanvasElement): Promise<void>;
  loadAsset(asset: RuntimeAsset): Promise<void>;
  render(frame: RenderFrame): void;
  dispose(): void;
}
```

将来、顔追跡SDKだけを商用製品へ差し替える場合でも、商品資産・Frame Factory・Catalog・品質評価を保持できるようにする。

### 5.3 MediaPipeの扱い

Face Landmarkerから得られる変換行列は姿勢の有力な入力とするが、Three.jsへ無加工で直結しない。

理由：

- 座標系の向きが異なる
- 前面カメラ反転がある
- video elementの表示領域と入力フレームが一致しない場合がある
- cover/cropによって画面端の誤差が増える
- Three.jsカメラと推定側仮想カメラのFOVを整合させる必要がある
- 変換行列の奥行き・縮尺は平均顔仮定の影響を受ける

PoseAdapterとCameraCalibrationを独立モジュールにする。

### 5.4 スケール

虹彩径はユーザー入力不要の初期推定として採用するが、唯一の正解にはしない。

ScaleResolverは、複数フレームの中央値、顔の画素数、左右差、信頼度を用いて推定を更新する。

縮尺確信度が低い場合は、次のフォールバックを許可する。

- 顔を近づける案内
- 手動サイズ微調整
- 既知サイズ物体による任意校正
- 商品の見た目比較だけを行う低確信モード

PDを正式なユーザー機能として表に出さない。Jessicaは度入り眼鏡を初期対象とせず、医療・処方用途を扱わないためである。

### 5.5 フィルタリング

単純なEMAだけでは、静止時のブレを抑えるほど移動時の遅延が増える。

初期標準はOne Euro Filterとし、平行移動と回転を別パラメータで平滑化する。実装は差し替え可能にする。

### 5.6 ConfidenceGate

追跡の状態を次で管理する。

```text
idle
→ acquiring
→ tracking
→ degraded
→ lost
```

閾値の上下にヒステリシスと保持時間を設ける。

- 一瞬の低下で即座に消さない
- 長く低下したら誤表示を続けない
- 再検出直後に位置が跳ねない
- 状態ごとにUIと描画強度を変える

### 5.7 オクルージョン

MVPからMediaPipe顔メッシュを深度専用で描画する。

顔メッシュは色を書かず、深度バッファだけへ書く。これにより顔の裏側へ回ったテンプルを自然に隠す。

髪の毛は初期対象外とし、「髪を耳にかける」案内で対応する。

### 5.8 レンダリング

初期構成：

- Three.js
- WebGL2
- GLB
- PBRマテリアル
- 小型環境マップ
- 透明・カラーレンズ
- depth-only face mesh

背景映像は実装初期はCSS video + 透明canvasとし、スクリーンショット時のみオフスクリーン合成する。単一canvas方式が品質・保守・性能で明確に優位だと実機で確認できた場合に移行する。

WebGPUは初期対象外。

### 5.9 性能戦略

- 顔推論：15〜24fpsを許容
- 描画：可能なら画面更新周期
- 入力解像度：640×480を初期基準
- 推論と描画を分離
- 端末性能によりモデル品質・反射・解像度を縮退
- MediaPipeのWorker実行とメインスレッド低頻度実行を実機比較して選択
- SharedArrayBuffer必須構成は外部EC埋め込み性を損なうため初期採用しない

---

## 6. 眼鏡資産大設計

### 6.1 資産の共通形式

すべてのRuntime資産はGLBとする。

glTF内部単位はm、商品メタデータはmmとする。

### 6.2 座標規約

```text
+Y = 上
+Z = 装用者から見て前方、顔から離れる方向
+X = 装用者から見て右
unit = metre
```

必須ノード：

```text
FRAME_ROOT
NOSE_ANCHOR
LENS_LEFT
LENS_RIGHT
HINGE_LEFT
HINGE_RIGHT
TEMPLE_LEFT
TEMPLE_RIGHT
```

モデルは標準アンカーへ正規化し、例外差を `attachmentMatrix` 1個で吸収する。大量の個別オフセットをRuntimeへ持ち込まない。

### 6.3 品質ティア

#### Proxy

- 正面輪郭の薄い押し出し
- パラメトリックテンプル
- 簡略レンズ
- 軽い角度まで

#### Standard

- 正面・左右・45度・上面などの情報
- フェイスカーブ
- 前傾角
- テンプル形状
- 丁番位置
- 通常商品向け

#### Premium

- 手動Blender調整またはCAD
- リムレス、ナイロール、二重ブリッジ、高カーブ、透明素材など
- 売上上位・広告主力・自動生成破綻商品向け

品質ティアは自動判定だけで決めず、人間レビューで確定する。

### 6.4 自動生成仮説

次の方式を代表20本で評価する。

- A：正面輪郭押し出しProxy
- B：正面＋側面＋実寸のパラメトリックStandard
- C：人間が作ったPremium基準
- D：商用VTO参考結果

比較項目：

- 人間作業時間
- 一発承認率
- 正面、15度、25度の見え方
- サイズ誤差
- 素材感
- モデル容量
- モバイル性能
- 修正回数

20本比較前に500本の一括撮影へ進まない。

---

## 7. Frame Factory 大設計

### 7.1 撮影ステーション

- 固定カメラまたはスマートフォン
- 三脚
- 固定照明とディフューザー
- 背景
- 高さ・角度・距離を再現できる眼鏡保持治具
- スケールマーカー
- デジタルノギス
- 角度ゲージ
- SKU読取

最重要設備はカメラではなく、毎回同じ姿勢で撮れる治具である。

### 7.2 撮影と計測

撮影：

- 正面
- 左右45度
- 左右側面
- 刻印
- 必要な型のみ上面・追加角度

計測：

- 刻印から lens width / bridge width / temple length
- ノギスで frame width / lens height / thickness
- 必要に応じ pantoscopic tilt / face wrap

色違いは同じFrameModelを共有し、外観差だけFrameVariantへ持つ。

現在のcapture-to-Proxy bridgeは、検証済みcapture draftの5寸法へthicknessを
暗黙補完しない。source/raw-label/half-open pixel regionへ束縛した未検証の
image/marking evidence、またはreason/bounds/limitationsを持つ明示的non-physical
Proxy assumptionのどちらかを要求する。dimension templateはcontour fidelityを
主張せず、manual image traceはsource SHAとpixel-to-mm ruleへ束縛してから
generator inputへ変換する。template/traceの完全なbodyはcanonical inputと
manifestへ残し、generatorがdigestと導出mm profileを再検証する。転記labelは
valueと一致するASCII numeric tokenを要求するがOCRは主張しない（ADR-0013）。

source画像座標はraw immutable encoded pixelsのtop-left origin、x-right/y-down、
half-open integer regionに統一する。JPEG/PNG/WebPのbyte inspectionがencoded/display
寸法とEXIF orientationを決定し、author declarationは受け付けない。orientation
2..8のsourceは、別hashとlineageを持つorientation-normalized derived sourceが
できるまでregion evidence/manual traceを禁止する。legacy geometryなしsourceは
raw-label-onlyに限る。orientation provenanceは座標解釈だけの証明であり、転記や
物理寸法の正しさではない（ADR-0015）。

### 7.3 最小制作画面

初期は一つの作業画面に限定する。

```text
左：撮影画像と実寸
中央：生成3D
右：テスト顔への試着
下：位置・角度・縮尺補正、承認、差し戻し
```

初期機能：

- 画像ドロップ
- 寸法入力
- 生成開始
- GLB確認
- テスト顔プレビュー
- 補正
- 承認・差し戻し
- 不変AssetVersion保存

50商品未満では、複雑な権限、請求、CSV大量操作、自由度の高いワークフローを作り込まない。

### 7.4 生成処理

生成処理はCloudflare Workersで行わない。

初期はローカル/WSLまたはコンテナWorkerを使用する。

- Python
- OpenCV
- Blender headless
- trimesh等
- 背景除去
- 輪郭抽出
- 押し出し・曲げ・テンプル生成
- GLB最適化
- プレビュー生成

処理結果だけをR2へアップロードする。

---

## 8. Catalog & Delivery 大設計

### 8.1 Plane分離

#### Control Plane

Supabase Postgresを標準とする。

- Tenant
- User
- FrameModel
- FrameVariant
- SourceAsset
- MeasurementSet
- GenerationJob
- AssetVersion
- QAReport
- Deployment
- Audit

Control Planeの権限境界はADR-0016に従う。正本の商品・evidence・
publication行はData API非公開の`private`へ置き、正規化した
tenant membershipを`auth.uid()`で毎回参照する。JWTのuser metadataや
staleになり得るapp metadataはtenant認可に使わない。Data APIの候補は
`api`の狭い`security_invoker`なreview/read viewだけとし、その基底tableで
RLS、membership predicate、最小grantを強制する。`anon`には許可しない。

publicationは不変な署名済みDeployment envelopeと、tenant/site/environmentごと
exact oneのactive pointerを分離する。replacement/rollbackは旧URLや旧Deploymentの
更新ではなく、prior digestに繋がりrevisionとgenerationが共に増えた
新Deploymentを作り、pointerを原子的に付け替える。catalogの
`recommendedForLive`は公開権限ではない。public-liveは引き続き署名済み
不変document/CDN APIのみを消費し、Supabase service credentialを持たない。

#### Delivery Plane

Cloudflareを標準とする。

- Pages：管理・デモ・Hosted Widget
- Workers：Catalog API、署名URL、イベント受付
- R2：原画像、GLB、texture、環境マップ、WASM、モデル
- CDN：公開資産配信

#### Processing Plane

ローカルまたはコンテナWorker。

### 8.2 公開モデル

AssetVersionは不変とする。更新は上書きではなく新Versionを作る。

Wave D1のQA境界では、人間のapprove/reject decision evidenceをversionedかつ
canonical hash-boundにし、review状態のGenerationJobとexact tenant/model/job、
processing input、review head、manifest/model hash/actual byte lengthへ束縛する。
Proxy approveは不変なcalibration `draft`の導出だけを許し、AssetVersionの
`approved`状態を意味しない。identity/version/URL/hash/source/generation/
attachment/envelope/statusは検証済み入力から決定論的に導出し、callerによる
relabelを許さない。Proxyは常にfixture、`recommendedForLive:false`、
calibration-only、non-promotableであり、物理・visual fidelity・actual-wear・
rightsの未証明要件は`false`/`null` blockerのまま保持する（ADR-0012）。

Deploymentが「現在公開中のAssetVersion」を指す。

これにより即時ロールバックと再現性を確保する。

`public-live` はcatalogの `published` / `recommendedForLive` を公開権限として扱わない。host固定のtenant/site/environment、deployment/catalog origin allowlist、`keyId → authorityId + P-256 public JWK`、revision/generation floor、signed document最大age/lifetimeをtrust rootとし、ES256署名済みDeployment envelopeの検証でexact 1 active pointerを得た場合だけ、その不変AssetVersionを取得する。SKU/model/variant/asset version、catalog/manifest/modelのactual-byte SHA-256、allowed origin、activation/audit、prior deployment digestをpointerへ束縛する。

rollbackは古いDeploymentを再利用せず、revisionとgenerationを共に増やした新Deploymentで以前のAssetVersionを指す。browserはWeb Locksで直列化したmonotonic receiptをtenant/site/environmentごとに保持する。ただし新規browserは過去receiptを持たないため、online freshness authorityなしに絶対的なreplay防止は主張しない。host floor、署名付きexpiry、最大age/lifetimeがfresh-client replay windowの上限である。

このlocal receipt方式のpublic-live browser下限はSafari 15.4（Web Locks利用可能）とする。Safari Lockdown ModeでWeb Locksが無効な場合は`navigator.locks`不在としてfail-closedにし、silent fallbackしない。必要ならlocal receiptとは別の外部freshness authorityを設計するunsupported/alternate-authority caseとして扱う。

### 8.3 カタログ取得元

Try-On RuntimeはカタログURLを設定で受け取る。

自社APIをハードコードしない。将来のテナント別、外部EC別、検証環境別の差し替えを可能にする。

---

## 9. EC組み込み大設計

### 9.1 標準方式

外部提供の標準はHosted iframe Widgetとする。

理由：

- 顧客ECのJavaScriptと衝突しにくい
- MediaPipe/Three.js/WASMの版をこちらで固定できる
- CSPとカメラ権限の責任境界を明確にしやすい
- 更新を一括配信できる
- 顔処理を独立オリジンへ閉じ込められる

### 9.2 通信

親ページとの通信は `postMessage` 契約で行う。

```text
jessica.ready
jessica.opened
jessica.assetChanged
jessica.captureCreated
jessica.cartRequested
jessica.closed
jessica.error
```

メッセージにはversionとtenantIdを持たせる。

WidgetProtocol v1ではさらにdirection、sessionId、single-use requestId、nullable
replyToを必須とし、親commandは`init`/`open`/`close`/`skuChange`、widget eventは
上記7種に`cameraPermission`と`tryOnStarted`だけを加えたclosed unionとする。
追加2 eventはcamera permission結果とruntime開始を区別する非同期lifecycleに必要で、
顔・映像・tracking情報を持たない。unknown version/type/field、非plain object、accessor、
cycle、non-finite、depth/size超過、wrong origin/source/tenant/session/request、replay、
stale lifecycleはfail closedで拒否する（ADR-0017）。

unknown入力にはnon-throwing safe parse APIを公開し、adapterはこれを使用する。exactに
binding済みのinbound requestIdはlifecycle判定より前に消費し、stale rejection後の再送を
状態変化後に受理しない。correlated recoverable errorは各commandの直前stable stateへ
決定論的にrollbackし、close responseはrequest reasonとexact一致を必須とする。widget側の
controller side effectはat-most-onceで、response送信失敗はlocal closed + deterministic
transport rejectionとなりbroken portへの再帰sendをしない。

page hide/destroyがinit/open response待ちでも、親はbound iframeへexact terminal closeを
best-effort送信して直ちにlocal closed/destroyedとなり、queued ready/openedで復帰しない。
terminal後のwidget public event送信を禁止する。observer例外はmessage listener外へ漏らさず、
message/page-hide listener登録はpartial failure時にrollbackする。

captureはsession-localなbounded opaque referenceだけを返し、bytes/blob/data URL/URLを
親へ渡さない。biometric/face/video/image/landmark/transform/pose/scale/raw analyticsは
nested aliasを含め禁止する。errorはclosed code/class、recoverability、sanitized bounded
messageだけとし、path/stack/URL/token/key/secretを含めない。

### 9.3 自社統合

自社ECでは、必要に応じ直接組み込みを許可する。ただしRuntime本体の契約はHosted Widgetと共通に保つ。

---

## 10. データ・プライバシー・セキュリティ

### 10.1 顔データ

- 映像をアップロードしない
- ランドマークを送信しない
- ユーザー操作なしに写真保存しない
- 分析イベントへ生体情報を含めない
- ローカル保存画像はユーザー端末上で扱う

### 10.2 商品資産

- 原画像はprivate bucket
- 公開GLBはversioned immutable path
- 管理APIは認証必須
- tenantIdを全主要テーブルへ持つ
- 監査ログを残す
- URL入力、ファイル種別、サイズ、ハッシュを検証する

#### Runtime asset trust chain (`JSC-0207`)

Runtimeはデプロイ設定で許可されたoriginのcatalogだけを入口とし、次の順でfail-closed検証する。

```text
allowed catalog origin
→ unknown JSON catalog contract
→ manifest actual bytes SHA-256
→ manifest identity / source hashes / unit=metre / bounds / required nodes
→ GLB actual bytes SHA-256 and byteLength
→ GLB header / chunks / active-scene nodes / POSITION actual bytes
→ the same verified ArrayBuffer passed to GLTFLoader
```

catalog、manifest、modelの全URLに、host固定catalog allowlistと署名済みpointerの`allowedOrigin`の積集合を適用し、redirect後のoriginも再検証する。live pathは署名検証済みactive `Deployment`に加えて`published`かつ`QualityEnvelope.recommendedForLive=true`だけを許可する。`approved`はQA preview、`draft`のcalibration proxyは明示self-test fixture専用で、live pathへfallbackしない。

E2 commerce requestもこの唯一のpublic-live pathを再利用する。requestはtenant/site/
production、SKU/model/variantとexplicit same-model fallback targetをexactに束縛する。
requested SKUが存在する場合はfallbackせず、missingの場合だけ明示targetを評価する。
selected entryは署名済みDeploymentのtenant/SKU/model/variant/asset ID+version/manifest hashと
完全一致し、catalog recommendation/default SKUはauthorityにならない。first-asset prefetchは
最大1 keyでcancellable、consumerは同じverified GLB bytesを再利用する。unavailable eventは
closed reasonとbounded IDsだけを持ち、raw error/URL/path/stack/secretsやface/camera/image/
landmark/pose/scaleを持たない。sink failureはprimary resultへ影響しない（ADR-0018）。

E3はWidgetProtocolやcatalog eventをanalyticsへ直送せず、独立したstrict schema-v1
commerce event境界へ変換する。open/permission result/try-on started/product changed/
capture occurrence/cart requested/close/stable error classだけを許し、全eventをtenant/site/
environment/session/event/request、1..256 sequence、bounded UTC timestampへ束縛する。
商品帰属が必要なeventはSKU/model/variant/asset ID+version/deployment IDとcatalog/manifest/
model SHA-256を必須とする。captureRefはsession-localでも分析上不要なlinkabilityを増やすため
telemetryへ含めず、captureが発生した事実だけを記録する（ADR-0019）。

pure lifecycle evaluatorはreplay/reorder/cross-binding、permission前start、active try-on前の
capture/cart、明示product-changeなしのasset relabel、terminal close後eventを拒否する。
batchは1..32 event、event 8,192 bytes、final canonical envelope 32,768 bytes、5,000 ms
timeoutをexact上限とする。full batch-body SHA-256からidempotency keyを導出し、
`priorBatchSha256` chainとcross-batch lifecycle replayをdispatch前に必須とする。accepted時だけ
ledgerを進め、AbortSignal、closed retry/terminal classificationを持つ。sink response/clockも
hostile input/exceptionとしてcontainする。
pure evaluatorのstructural stateはtest/replay用に残すが、production dispatchはprivate WeakMapに
登録されたopaque ledgerだけを受け付ける。correct prior digestを持つplain forged active stateも
sinkへ到達できず、cross-tenant/session state substitutionを拒否する。
ParentWidgetHostとDeployedCatalogIntegrationには明示adapterだけで接続し、observer/sink failureは
try-on/catalog/cart resultへ影響しない。local/fake sinkはproduction telemetry、consent、analytics、
commerce evidenceではない。

productionの商品帰属はcallerの`productForSku` self-assertionを使わない。public-live loaderが
exact `VerifiedRuntimeAsset` object identityへprivate proofを登録し、try-on-web registryがverified
Deploymentとcatalog entryのSKU/model/variant/asset/version/catalog/manifest/model hashからのみ
attributionを導出する。structural clone、QA/calibration、unregistered inputはauthorityを持たない。
registry自身もexact bounded tenant/site/production scopeをconstructorで固定し、register/resolve/
session factoryの全てで一致を必須とする。同じSKUでもscopeの異なるregistry間では共有しない。

E4のstatic/low-vision captureは、RuntimeやE1/E3のmedia境界を広げない。pure reducerと
injected timer/audio/capture portsを使い、`unavailable`/`ready`/`countdown`/`capturing`/
`review`/`failed`/`paused`/`closed`/`destroyed`を明示する。countdownはexact 3→2→1で、
各stepはone-shotかつgeneration-bound、captureは1 countdownにつき最大1回とする。
cancel、camera unavailable、page hidden、close、destroyはtimerとin-flight captureを無効化し、
late resultをdisposeする。stillはlocal Blob object URL capabilityの背後だけで保持し、永続化・
upload・contract serializationを行わない。E1にはbounded session-local `captureRef`だけ、E3には
引数なしのcapture occurrenceだけを別々のexception-contained observerから渡す（ADR-0020）。

audio cueは既定offで、利用者が明示的にonにしたcountdownだけ再生を試みる。autoplay成功を
前提にせず、拒否/非対応でもvisual countdownとcaptureは継続する。reviewは眼鏡をかけ直した後の
確認用modalで、native button、focus移動/復帰、Escape terminal close、live status/timer、
large target、contrast-safe tokens、text併記、reduced-motion/forced-colorsを備える。このlocal
preparationは実ブラウザ/支援技術/実機評価またはaccessibility certificationではなく、G4を通過させない。

prefetch cache keyはrequestIdではなくtenant/site/environment/SKU/model/variant/fallbackの
semantic identityとする。consumer固有cancelはshared prefetchを止めず`REQUEST_CANCELLED`を
返し、failure eventは各consumer requestIdへ束縛する。freshness deadlineはsigned expiryと
host maximum ageの最小値で、cache利用はstrictにその直前まで、exact deadline以後はsigned
Deploymentから全chainを再検証する。catalog/manifest/envelope/Deployment unknown objectは
getter/symbol/custom prototype/hostile arrayを実行前に拒否し、envelopeはContent-Length不在でも
256 KiB streaming boundを適用する。

host deployment origin listはnon-empty exact canonical HTTPS originだけを許し、path、trailing
slash、HTTP、credential、invalid entryをfetch前に拒否する。deployment/catalog/manifest/modelと
全redirect URLはusername/passwordを禁止する。Response取得後のnon-ok、redirect/origin/
credential拒否、invalid/oversized Content-Lengthはunread bodyをbest-effort cancelしてから
stable fail-closed classificationを返す。

RuntimeModeは `public-live` / `qa-preview` / `calibration` の3値とする。public-liveはnon-fixtureの`published + recommendedForLive`、qa-previewはnon-fixtureの`approved | published`、calibrationは明示fixtureの`draft + proxy + recommendedForLive=false`だけを許可する。admission拒否はMediaPipe backend、WebGL、GLB model取得より前に確定する。

### 10.2.1 Tracking fail-closed policy (`JSC-0208`)

MediaPipe Face Landmarkerの結果にはface presence/tracking scoreが返らないため、landmark `visibility`を信頼度へ読み替えない。confidenceはSDK存在判定ではなく、ランドマーク完全性・有限性、画面内比率、顔pixel span、正規化形状の時間残差、transform jumpをpure coreで決定論的に評価した値とする。

`maxYawDeg` / `maxPitchDeg`はfilter前のraw quaternionを正規化しYXZ角へ変換して同一frameで判定する。角度外、必要scale confidence未満、または`millimetresPerPixel`不在はholdなしで最終opacityを0にする。tracking confidenceだけが低い場合はhysteresisを許すが、最初にexit threshold未満となったwall-clock時刻から250 ms以内に必ずopacity 0とする。新規frameが来ない、または非同期detectがpendingの時もgeneration-safe watchdogが最後の表示を隠す。main threadを同期的に占有するMediaPipe呼び出し自体はtimerでpreemptできないため、このwall-clock保証はbrowser event loopが進行する条件付きであり、絶対的なpreemptionにはWorker境界が必要である。

### 10.3 埋め込み

- iframe originを固定
- `postMessage` originを厳密検証
- カメラ権限の明示
- CSP文書を用意
- 外部カタログURLはallowlist方式

親adapterはexact HTTPS widget originと明示path prefix内のquery/fragmentなしURLを固定し、
`targetOrigin`にwildcardを使わない。iframe sandboxは`allow-scripts allow-same-origin`、
feature delegationはexact widget originへのcameraだけとする。親のPermissions-Policy/
`frame-src`とwidget側の`frame-ancestors`/resource CSPは別ownerが実responseで設定・検証する。
候補policyと責任境界は`docs/11_HOSTED_WIDGET_EMBED_SECURITY.md`に置くが、production header
設定済みとは主張しない。signed embed token/API key/auth、analytics backend、live EC検証は
後続境界である。

---

## 11. 品質大設計

### 11.1 Ground Truth

最初に3人×5フレーム×正面/左右斜めを基準とし、実物着用写真と実測値の対を作る。

`canonical-validation`ではこれを3 pseudonymous subjects × 5 distinct frame models × `front`/`left`/`right`のexact 45 Cartesian cellsとして扱う。`technical-single-frame-slice`は算術・tooling成立の別profileであり、canonical/G1 PASSではない。promotion semantics、evidence integrity、device軸はADR-0007に従う。

後に顔幅、鼻形状、年代などの多様性を追加する。

### 11.2 指標

- ブリッジ位置誤差
- フロント幅誤差
- レンズ中心と瞳中心の関係
- roll誤差
- yaw時の剥離
- 静止時ジッターRMS
- 復帰時のジャンプ
- FPS
- 初回ロード
- メモリ
- 発熱
- 眼鏡店による印象一致

### 11.3 暫定目標

- 正面位置誤差中央値：3mm以内
- フロント幅：±5%以内
- 正常条件の追跡成功率：90%以上
- 中級スマートフォン：24fps以上
- 低信頼状態で誤表示を継続しない

最初のGround Truth取得後に、測定可能性と商用品質を見ながら閾値を更新する。ただし閾値未定のままリリースしない。

---

## 12. 500本展開の考え方

### 12.1 SKUと型を分離する

500が販売SKU数か独立形状数かを棚卸しする。

同形状の色違い・レンズ違いは1つのFrameModelを共有する。

### 12.2 展開順

1. 売上上位
2. 試着リクエスト上位
3. 継続販売商品
4. 形状代表
5. その他

未デジタル化商品のページにも「試着リクエスト」を置き、優先順位を実需で更新する。

### 12.3 一括着手しない

```text
1本
→ 代表20本
→ 25本
→ 自社EC 100本
→ 量産判断
→ 500本
```

各段階で撮影・生成・レビューの実工数を測る。

### 12.4 F1 Demand Queue local preparation

F1は実データを推測せず、E2 `CatalogUnavailableEvent` またはE3のstable
`commerce.error` unavailable occurrenceだけを明示adapterで受ける。raw error、URL、capture
reference、image、landmark、pose、user/session/device/biometric identity、free-form analyticsは
入力にもqueue commandにも含めない。E2とE3が同じrequestを表す場合は共通`correlationId`で
1需要として数え、異なるtargetへの再相関は拒否する。

targetはtenant/site/production scope内のSKU + FrameModel + FrameVariant + closed frame-shape、
または明示的なunresolved candidate ID + frame-shapeに束縛する。同じscopeでSKU、variant、
candidate IDをmodel/shapeへ付け替える入力、cross-tenant/site、future/reordered snapshot、同時刻の
conflicting snapshotはfail closedとする。

policy `f1-local-v1` は30日間（exact boundaryを含む）のdeduplicated unavailable demandを使う。
sales rankは24時間、inventoryは1時間、shape coverageは7日をfreshとし、各exact boundaryを含む。
freshな`continuous + in-stock` inventoryだけがqueue eligibleで、missing/stale/unknown/
discontinuous/out-of-stockはclosed reason付きで除外する。sales rankまたはcoverageのmissing/staleは
需要や在庫を捏造せず0 bonusとする。priorityは
`demandCount × 1000 + salesRank bonus(0..100) + underrepresented-shape bonus(25)`で、
demand 1件が全bonusより常に強い。tieはoldest demand、次にcanonical target identityで固定する。

1 buildはevidence 1,000、各metric sample 1,000、queue 500、canonical command 512 KiBを上限とする。
commandはnested item/reason/order/score/window/identityを再parseし、canonical SHA-256と
`dqv1_` idempotency keyを持つ。これは同じ運用queue outputをcoalesceするidempotencyであり、
raw input/source evidence digestではない。read/time/write port failureとhostile write acknowledgementは
closed resultへcontainする。commandは常に`operationalStatus=local-preparation-only`かつ
`g5Ready=false`であり、実売上・実在庫・代表catalog・production queue・人間工数・運用証跡なしに
G5をactivate/passしない（ADR-0021）。

### 12.5 F2 Batch Capture local preparation

F2のlocal workflowはschema v1のappend-only event logとpure replay reducerで表現する。
batchはtenant/site/production/operator-session/batchへ、各itemはSKU/FrameModel/FrameVariantへ
exactに束縛する。SKUとitemはbatch内uniqueとし、FrameVariantを別SKU/modelへ付け替えない。
同一FrameModelの複数variantは製品データモデルどおり許容するが、variant identityはSKUを含む
catalog identityへ一意に束縛する。これはE2/F1のtarget authorityを置換せず、capture側が受け取った
identityを再分類・再優先付けしないための境界である。
同一FrameModel内の`productType`は固定し、`model-primary`を名乗れるvariant tupleは最大1つとする。

operatorはclosedなproduct type (`optical-frame` / `sunglasses`) とvariant classification
(`model-primary` / `color-variant`) をitem binding時に明示する。raw camera/product bytesはevent、
fixture、Widget、commerce、analytics、public catalogへ入れない。private rawはpath/URL/data URLではない
bounded `localraw:` referenceだけを持ち、別application layerが発行するbatch/item/reference/expiry-bound
object-identity capabilityを一回消費したときだけrecordできる。capture ID、capability ID、local referenceは
batch全体で再利用・付け替え不可とする。
capability expiryはevent timestampと同じ2020-01-01〜2100-01-01 inclusive範囲に限定し、
全batch replay/budget検証が成功した後だけgrantを消費する。

各captureはclosed issue codesを使うoperator quality decisionを必須とする。`retake`は次のcaptureだけを
許しadvanceできず、`accept`または`reject`だけがitem advanceを許可する。completed stateにも各itemの
accept/reject outcomeを保持し、完了を品質承認と解釈しない。sequence/time/binding/event IDを厳密にreplayし、
exact already-appended retryだけをidempotentとする。最大100 items、1,000 events、1 MiB canonical log、
16 issue codes/item-decisionを上限とする。completionは常に
`operationalStatus=local-preparation-only`, `g5Ready=false`である（ADR-0022）。

### 12.6 F3 Review Operations local preparation

F3はschema v1のwork itemとappend-only evidence chainをpure reducerでtriageする。work itemと
各evidenceはtenant/site/production、SKU/FrameModel/FrameVariant、GenerationJob identity、reviewed
input/output hash候補、AssetVersion identity/version候補、`f3-local-v1`、source/capture evidence digest候補を
exactに束縛する。F1 demand commandとF2 batch logはnullableなdigest候補としてだけ参照し、`localraw:`、
raw byte/path/URL/media、people/session/camera/biometric、free-form note、commerce/analytics payloadを持たない。
これらdigestは`candidate-references-unverified`であり、local integrity bindingであってupstream ledger/source
authorityの検証済み証明ではない。
各evidenceの`evaluationAuthority`は`local-candidate-unverified`に固定する。`evaluatorId`、
`evaluatorVersion`、findingsはunauthenticated local candidate labelであり、人間reviewまたはsource authorityを
証明しない。finding/reason/outcomeのruntime allowlist自体もfreezeし、consumer mutationで拡張できなくする。

outcomeは`auto-review-candidate`、`correction-required`、`manual-required`、`rejected`のclosed unionである。
rejected、manual、correction、autoのseverity順と、evidence time/work identityによるtie-breakを固定する。
autoはQA approve、AssetVersion promotion、`recommendedForLive`、active Deployment、publication、G1/G2/G5
evidenceのいずれでもない。correctionはclosed categoryと最大3 attemptを持ち、exhaustionはmanualへ送る。
manualは後続の明示的人間review authorityを必要とする。rejected chainはterminalで、新しいGenerationJobと
distinct asset/version candidateだけが別work identityを作れる。

durable queue itemはheadだけでなく最大4件の正規化evidence chain全体を持つ。command parser自身がhash、
previous digest、sequence/attempt/time/freshness、binding、terminal transition、outcome/reason/severity/orderを
再検証する。exact retryはoriginal eventの直後だけidempotentで、orphan head、reorder、stale/future、relabel、
redigestしたstatus escalation、queue substitution、TOCTOU、hostile structure、512 KiB超過をfail closedにする。
commandは常に`local-preparation-only`、`g5Ready=false`かつ全authority falseである（ADR-0023）。

### 12.7 F4 Reprocessing local preparation

F4はprior asset/version、manifest/model、GenerationJob/review/QA、source/capture候補digestと、新しい
generation request identity/input digestをexactに束縛するschema-v1 ledgerである。raw materialは
`digest-references-only-unverified`だけで、実行authorityはfalseのためregeneration executionを主張しない。
完全なclosed metric setがない比較はmanual-requiredとなる。canaryはexact SKU、最大25% traffic、最大24時間の
local planだけであり、rollbackはexactな古いunverified referenceだけを保持する。いずれも後続のhuman/control-
plane authorityが必要で、Deployment/publicationを変更しない。commandは`local-preparation-only`,
`g5Ready=false`と全authority falseを固定する（ADR-0024）。

### 12.8 G6 External Service Readiness local preparation

G6の最初のlocal sliceは、tenant/site/productionとexact parent/widget/catalog/asset HTTPS origin、widget
path/URLを束縛するstrict profileだけをonboarding candidateとする。WidgetProtocol identityは既存exportから
導出し、E1のCSP、Permissions-Policy、sandbox、camera delegationを弱めずcandidate requirementsとして再現する。
実response headerとlive browser検証は外部要件のままである。

usageは`widget-session-opened`、`try-on-started`、`catalog-selection-succeeded`のclosed occurrenceだけを
最大256件/24時間のhash chainでlocal replayする。non-billableであり、media/capture/biometric/raw error/
medical/prescription/pricing/invoice/payment/free-form dataを持たない。全external prerequisiteは
`pending-external`、commandは`local-preparation-only`、`g6Ready=false`、全authority falseである。認証、
signed onboarding、production delivery、legal/IP、real usage、billing/pricing、staffed supportは作らない
（ADR-0025）。

---

## 13. ピボット設計

Jessicaは全面自前か全面SDKかの二択にしない。

### 13.1 生成が難しい場合

- Premiumだけ外注
- 自動生成破綻商品を非対応にする
- Frame Factory、Catalog、Runtimeは継続

### 13.2 顔追跡が難しい場合

- FaceTrackingBackendだけ商用SDKへ差し替える
- 商品資産と事業データは保持する

### 13.3 Runtimeが商用SDKより劣る場合

- 自社ECのRuntimeは商用SDK
- Digitize OnlyとCatalogを自社継続
- 独自Fit Intelligenceを別層で提供

### 13.4 停止条件

- 20本の一発承認率が50%未満
- 標準商品の人間修正が15分/本を超える
- 手動モデリング対象が25%を超える
- 対象端末で安定20fpsを維持できない
- 追跡誤差が品質ゲートを継続的に超える
- 外販と独自フィット機能の両方を取り下げる

停止とはJessica全体の放棄ではなく、問題のある構成要素を差し替える判断を意味する。

---

## 14. 法務と表示

外販前に次を必須確認する。

- VTO/眼鏡デジタル化関連特許
- MediaPipe、Three.js、生成ツールのライセンス
- プライバシーポリシー
- 顔処理と分析イベントの説明
- 試着表示の免責
- 色味、濃度、サイズの参考表示
- 景品表示法上の誤認防止

サングラスのレンズは単なるopacityではなく、可能な商品では可視光線透過率等の実物情報を管理し、表示を過度に美化しない。

---

## 15. 最初の縦断ゴール

最初に完成させるものはZenniの完全コピーではない。

**J1-M 1本を、コード修正なしに次の商品へ拡張できる構造で自然に試着する縦断システム**である。

```text
J1-M原画像・寸法
→ 1本のGLB
→ Camera
→ FaceTracking
→ Pose/Scale
→ Confidence/Filter
→ Depth Occlusion
→ Render
→ Ground Truth Report
```

この縦断がJessica全体の最小核になる。
