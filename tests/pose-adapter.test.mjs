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
    sourceSize: fixture.imageSize,
    viewportSize: fixture.viewportSize,
    mirrored: false,
    verticalFovDeg: fixture.verticalFovDeg,
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
  const halfHeight = depth * Math.tan((calibration.verticalFovDeg * Math.PI) / 360);
  const aspect = calibration.viewportSize.width / calibration.viewportSize.height;
  assert.ok(Math.abs(pose.position.x / (halfHeight * aspect) - expected.x) < 1e-12);
  assert.ok(Math.abs(pose.position.y / halfHeight - expected.y) < 1e-12);
});

test("mirroring flips viewport position and yaw while preserving a unit quaternion", () => {
  const angle = Math.PI / 6;
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  const yawMatrix = [c, 0, -s, 0, 0, 1, 0, 0, s, 0, c, 0, 0, 0, -50, 1];
  const adapter = new MediaPipePoseAdapter({ noseAnchorLandmarkIndex: 0 });
  const regular = adapter.resolve(tracking({ matrix: yawMatrix, anchor: { x: 0.6, y: 0.5, z: 0 } }), camera());
  const mirrored = adapter.resolve(
    tracking({ matrix: yawMatrix, anchor: { x: 0.6, y: 0.5, z: 0 } }),
    camera({ mirrored: true }),
  );
  assert.ok(Math.abs(regular.position.x + mirrored.position.x) < 1e-12);
  assert.ok(Math.abs(regular.rotation.y + mirrored.rotation.y) < 1e-12);
  assert.ok(Math.abs(Math.hypot(...Object.values(mirrored.rotation)) - 1) < 1e-12);
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
