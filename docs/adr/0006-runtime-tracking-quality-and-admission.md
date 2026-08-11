# ADR 0006: Runtime tracking quality, envelope, and admission

## Status

Accepted — JSC-0208.

## Decision

MediaPipe Face Landmarkerのface有無をconfidence 1/0へ変換しない。FaceLandmarkerResultがpresence/tracking scoreを返さないため、landmark visibilityもconfidenceとして使用しない。pure tracking coreがcanonical landmark構造、有限性、in-frame比、pixel span、正規化時間残差、transform jumpを決定論的に評価する。

ConfidenceGateは最初のbelow-exit wall-clock時刻を状態遷移と独立して保持する。tracking-onlyの低下にはhold/hysteresisを許すが、no-faceとmoderate-lowはいずれも250 ms境界でopacity 0とする。SingleFrameRuntimeはgeneration/visibility lease付きwatchdogでno-frameおよびevent loopが進行する非同期pending detectを隠す。同期MediaPipe呼び出しがmain threadを占有する場合のpreemptionはWorker化まで保証しない。

QualityEnvelopeはfilter前のraw quaternionを正規化してYXZ角へ変換し、yaw/pitchを同一frameで判定する。`scaleConfidence`の既存field名は互換維持し、その意味を最低要求rankと固定する。mm-per-pixel availabilityはrankとは独立した必須条件である。違反はholdなしで最終opacity 0とする。

RuntimeMode admissionは以下とする。

- `public-live`: non-fixture、published、recommendedForLive
- `qa-preview`: non-fixture、approvedまたはpublished
- `calibration`: explicit fixture、draft proxy、not recommendedForLive

資産quality tierはadmissionを単独決定しない。rendererはこれらのpolicyを知らず、検証済みArrayBufferと最終opacityだけを忠実に扱う。

## Consequences

tracking/asset違反理由、YXZ角、asset tierがruntime Viewへ公開される。catalog拒否はbackend/WebGL/GLB model load前に完了し、JSC-0207の同一検証済みArrayBuffer境界を維持する。active Deployment pointerは引き続き別control-plane課題である。
