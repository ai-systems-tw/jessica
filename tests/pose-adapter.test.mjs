import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { MediaPipePoseAdapter, landmarkToViewportNdc } from "../dist/packages/pose/src/index.js";

const fixture = JSON.parse(
  await readFile(new URL("../fixtures/tracking/canonical-pose.json", import.meta.url), "utf8"),
);

function tracking(overrides = {}) {
  return {
    timestampSeconds: 1,
    confidence: 0.9,
    landmarks: [overrides.anchor ?? fixture.noseAnchor],
    facialTransform: overrides.matrix ?? fixture.facialTransform,
    imageSize: fixture.imageSize,
  };
}

function camera(overrides = {}) {
  return {
    projectionIdentity: { profileId: "fixture", profileSha256: "0".repeat(64), admission: "fixture-only" },
    sourceSize: fixture.imageSize,
    viewportSize: fixture.viewportSize,
    intrinsics: { fxPx: 772.0224913834411, fyPx: 772.0224913834411, cxPx: fixture.imageSize.width / 2, cyPx: fixture.imageSize.height / 2 },
    displayMirror: "none",
    objectFit: "cover",
    ...overrides,
  };
}

test("canonical centered face resolves to the Three.js -Z camera axis", () => {
  const pose = new MediaPipePoseAdapter({ noseAnchorLandmarkIndex: 0 }).resolve(tracking(), camera());
  assert.ok(Math.abs(pose.position.x) < 1e-12);
  assert.ok(Math.abs(pose.position.y) < 1e-12);
  assert.equal(pose.position.z, -0.5);
  assert.deepEqual(pose.rotation, { x: 0, y: 0, z: 0, w: 1 });
});

test("unprojected pose projects back to the crop-adjusted landmark NDC", () => {
  const calibration = camera();
  const anchor = { x: 0.6, y: 0.42, z: 0 };
  const expected = landmarkToViewportNdc(anchor, calibration);
  const pose = new MediaPipePoseAdapter({ noseAnchorLandmarkIndex: 0 }).resolve(
    tracking({ anchor }),
    calibration,
  );
  const depth = -pose.position.z;
  const u = anchor.x * calibration.sourceSize.width;
  const v = anchor.y * calibration.sourceSize.height;
  assert.ok(Math.abs(pose.position.x - (u - calibration.intrinsics.cxPx) / calibration.intrinsics.fxPx * depth) < 1e-12);
  assert.ok(Math.abs(pose.position.y + (v - calibration.intrinsics.cyPx) / calibration.intrinsics.fyPx * depth) < 1e-12);
  assert.ok(Number.isFinite(expected.x));
});

test("selfie mirroring is compositor-owned and leaves internal pose a proper unreflected transform", () => {
  const angle = Math.PI / 6;
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  const yawMatrix = [c, 0, -s, 0, 0, 1, 0, 0, s, 0, c, 0, 0, 0, -50, 1];
  const adapter = new MediaPipePoseAdapter({ noseAnchorLandmarkIndex: 0 });
  const pose = adapter.resolve(tracking({ matrix: yawMatrix, anchor: { x: 0.25, y: 0.5, z: 0 } }), camera({ displayMirror: "css-compositor-x" }));
  const internal = landmarkToViewportNdc({ x: 0.25, y: 0.5 }, camera({ displayMirror: "css-compositor-x" }));
  assert.ok(internal.x < 0);
  assert.ok(-internal.x > 0, "the shared CSS transform mirrors the complete video/canvas composition once");
  assert.ok(Math.abs(Math.hypot(...Object.values(pose.rotation)) - 1) < 1e-12);
});

test("contain mapping preserves letterbox offsets and edge direction", () => {
  const calibration = camera({ viewportSize: { width: 1000, height: 1000 }, objectFit: "contain" });
  assert.deepEqual(landmarkToViewportNdc({ x: 0.5, y: 0.5 }, calibration), { x: 0, y: 0 });
  const topEdge = landmarkToViewportNdc({ x: 0.5, y: 0 }, calibration);
  assert.ok(topEdge.y > 0);
  assert.ok(topEdge.y < 1);
});

test("rejects source-size mismatch and invalid camera depth", () => {
  const adapter = new MediaPipePoseAdapter({ noseAnchorLandmarkIndex: 0 });
  assert.throws(() => adapter.resolve(tracking(), camera({ sourceSize: { width: 1, height: 1 } })), /must match/);
  const behindCamera = [...fixture.facialTransform];
  behindCamera[14] = 50;
  assert.throws(() => adapter.resolve(tracking({ matrix: behindCamera }), camera()), /in front/);
});
