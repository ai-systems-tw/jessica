import type { AssetQuality, QualityEnvelope, ScaleConfidence } from "../../contracts/src/index.js";
import type { HeadPose, Quaternion, ScaleEstimate } from "./types.js";

export type HeadAngles = { yawDeg: number; pitchDeg: number; rollDeg: number };
export type QualityEnvelopeReason =
  | "invalid-head-rotation"
  | "yaw-out-of-envelope"
  | "pitch-out-of-envelope"
  | "scale-confidence-insufficient"
  | "scale-unavailable";

export type QualityEnvelopeEvaluation = {
  allowed: boolean;
  reasons: readonly QualityEnvelopeReason[];
  angles: HeadAngles | null;
  assetQuality: AssetQuality;
};

const toDegrees = (radians: number): number => radians * 180 / Math.PI;
const canonicalDegree = (radians: number): number => {
  const degrees = toDegrees(radians);
  return Math.abs(degrees) < 1e-12 ? 0 : degrees;
};

export function headAnglesFromQuaternion(value: Quaternion): HeadAngles {
  if (![value.x, value.y, value.z, value.w].every(Number.isFinite)) {
    throw new RangeError("quaternion components must be finite");
  }
  const length = Math.hypot(value.x, value.y, value.z, value.w);
  if (!Number.isFinite(length) || length <= 1e-12) {
    throw new RangeError("quaternion must have non-zero finite length");
  }
  const x = value.x / length;
  const y = value.y / length;
  const z = value.z / length;
  const w = value.w / length;
  const m11 = 1 - 2 * (y * y + z * z);
  const m13 = 2 * (x * z + y * w);
  const m21 = 2 * (x * y + z * w);
  const m22 = 1 - 2 * (x * x + z * z);
  const m23 = 2 * (y * z - x * w);
  const m31 = 2 * (x * z - y * w);
  const m33 = 1 - 2 * (x * x + y * y);
  const pitch = Math.asin(-Math.max(-1, Math.min(1, m23)));
  const regular = Math.abs(m23) < 0.9999999;
  const yaw = regular ? Math.atan2(m13, m33) : Math.atan2(-m31, m11);
  const roll = regular ? Math.atan2(m21, m22) : 0;
  return { yawDeg: canonicalDegree(yaw), pitchDeg: canonicalDegree(pitch), rollDeg: canonicalDegree(roll) };
}

const scaleRank: Record<ScaleConfidence, number> = { low: 0, medium: 1, high: 2 };

export function evaluateQualityEnvelope(input: {
  rawPose: HeadPose;
  scale: ScaleEstimate;
  envelope: QualityEnvelope;
  assetQuality: AssetQuality;
}): QualityEnvelopeEvaluation {
  const reasons: QualityEnvelopeReason[] = [];
  let angles: HeadAngles | null = null;
  try {
    angles = headAnglesFromQuaternion(input.rawPose.rotation);
  } catch {
    reasons.push("invalid-head-rotation");
  }
  if (angles && Math.abs(angles.yawDeg) - input.envelope.maxYawDeg > 1e-9) reasons.push("yaw-out-of-envelope");
  if (angles && Math.abs(angles.pitchDeg) - input.envelope.maxPitchDeg > 1e-9) reasons.push("pitch-out-of-envelope");
  if (scaleRank[input.scale.confidence] < scaleRank[input.envelope.scaleConfidence]) {
    reasons.push("scale-confidence-insufficient");
  }
  if (input.scale.millimetresPerPixel === null || !Number.isFinite(input.scale.millimetresPerPixel) || input.scale.millimetresPerPixel <= 0) {
    reasons.push("scale-unavailable");
  }
  return { allowed: reasons.length === 0, reasons, angles, assetQuality: input.assetQuality };
}
