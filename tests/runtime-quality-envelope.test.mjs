import assert from "node:assert/strict";
import test from "node:test";
import {
  evaluateAssetAdmission,
  evaluateQualityEnvelope,
  headAnglesFromQuaternion,
} from "../dist/packages/runtime/src/index.js";

const close = (actual, expected, tolerance = 1e-8) => assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} != ${expected}`);
const axis = (name, degrees) => {
  const half = degrees * Math.PI / 360;
  return { x: name === "x" ? Math.sin(half) : 0, y: name === "y" ? Math.sin(half) : 0, z: name === "z" ? Math.sin(half) : 0, w: Math.cos(half) };
};

test("YXZ head angles normalize identity, axes, q/-q, nonunit, and combined rotations", () => {
  assert.deepEqual(headAnglesFromQuaternion({ x: 0, y: 0, z: 0, w: 1 }), { yawDeg: 0, pitchDeg: 0, rollDeg: 0 });
  for (const degrees of [-30, 30]) close(headAnglesFromQuaternion(axis("y", degrees)).yawDeg, degrees);
  for (const degrees of [-20, 20]) close(headAnglesFromQuaternion(axis("x", degrees)).pitchDeg, degrees);
  for (const degrees of [-15, 15]) close(headAnglesFromQuaternion(axis("z", degrees)).rollDeg, degrees);
  const combined = { x: 0.14487812541736916, y: 0.2685358227515692, z: -0.12767944069578063, w: 0.943714364147489 };
  const angles = headAnglesFromQuaternion(combined);
  close(angles.yawDeg, 30); close(angles.pitchDeg, 20); close(angles.rollDeg, -10);
  assert.deepEqual(headAnglesFromQuaternion(Object.fromEntries(Object.entries(combined).map(([key, value]) => [key, -value]))), angles);
  assert.deepEqual(headAnglesFromQuaternion(Object.fromEntries(Object.entries(combined).map(([key, value]) => [key, value * 7]))), angles);
});

test("head angles reject zero/non-finite and remain finite near gimbal lock", () => {
  assert.throws(() => headAnglesFromQuaternion({ x: 0, y: 0, z: 0, w: 0 }), /non-zero/);
  assert.throws(() => headAnglesFromQuaternion({ x: NaN, y: 0, z: 0, w: 1 }), /finite/);
  for (const pitch of [-90, -89.9, 89.9, 90]) {
    const angles = headAnglesFromQuaternion(axis("x", pitch));
    assert.ok(Object.values(angles).every(Number.isFinite));
    close(angles.pitchDeg, pitch, 1e-6);
  }
});

const asset = {
  quality: "standard", status: "published",
  qualityEnvelope: { maxYawDeg: 25, maxPitchDeg: 15, recommendedForLive: true, scaleConfidence: "medium" },
};
const pose = (rotation) => ({ position: { x: 0, y: 0, z: -0.5 }, rotation, sourceConfidence: 1 });

test("quality envelope applies raw angle and minimum scale requirements in deterministic order", () => {
  const denied = evaluateQualityEnvelope({
    rawPose: pose(axis("y", 26)),
    scale: { millimetresPerPixel: null, confidence: "low", sampleCount: 0 },
    envelope: asset.qualityEnvelope,
    assetQuality: asset.quality,
  });
  assert.equal(denied.allowed, false);
  assert.deepEqual(denied.reasons, ["yaw-out-of-envelope", "scale-confidence-insufficient", "scale-unavailable"]);
  const boundary = evaluateQualityEnvelope({
    rawPose: pose(axis("y", 25)),
    scale: { millimetresPerPixel: 0.5, confidence: "medium", sampleCount: 3 },
    envelope: asset.qualityEnvelope,
    assetQuality: asset.quality,
  });
  assert.equal(boundary.allowed, true);
});

test("runtime mode admission keeps quality tier separate from live eligibility", () => {
  assert.equal(evaluateAssetAdmission({ mode: "public-live", asset, fixture: false }).admitted, true);
  assert.equal(evaluateAssetAdmission({ mode: "qa-preview", asset: { ...asset, status: "approved", qualityEnvelope: { ...asset.qualityEnvelope, recommendedForLive: false } }, fixture: false }).admitted, true);
  assert.equal(evaluateAssetAdmission({ mode: "public-live", asset: { ...asset, quality: "premium", status: "approved" }, fixture: false }).admitted, false);
  assert.equal(evaluateAssetAdmission({ mode: "calibration", asset: { ...asset, quality: "proxy", status: "draft", qualityEnvelope: { ...asset.qualityEnvelope, recommendedForLive: false } }, fixture: true }).admitted, true);
});
