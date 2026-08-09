import assert from "node:assert/strict";
import test from "node:test";

import { Group, Mesh, MeshBasicMaterial, BoxGeometry } from "three";
import { mediaPipeFaceTriangleIndices } from "../dist/packages/face-tracking/src/index.js";
import { DepthOnlyFaceMesh, ThreeEyewearRenderer } from "../dist/packages/rendering/src/index.js";

function asset(modelUrl = "/assets/j1-m.glb") {
  return {
    asset: {
      id: "asset-j1-m-v1",
      tenantId: "jessica",
      frameModelId: "j1-m",
      version: 1,
      quality: "standard",
      generationMethod: "manual",
      modelUrl,
      manifestUrl: "/assets/j1-m.json",
      sourceAssetHashes: [],
      attachmentMatrix: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0.01, 0.02, 0.03, 1],
      qualityEnvelope: { maxYawDeg: 25, maxPitchDeg: 15, recommendedForLive: true, scaleConfidence: "medium" },
      status: "approved",
    },
  };
}

function rendererHarness() {
  const calls = { ratios: [], sizes: [], renders: 0, disposed: 0, urls: [] };
  const rendererPort = {
    setPixelRatio(value) { calls.ratios.push(value); },
    setSize(width, height, updateStyle) { calls.sizes.push({ width, height, updateStyle }); },
    render() { calls.renders += 1; },
    dispose() { calls.disposed += 1; },
  };
  const loaded = new Group();
  loaded.add(new Mesh(new BoxGeometry(0.14, 0.04, 0.02), new MeshBasicMaterial({ opacity: 0.8 })));
  const factory = {
    create() { return rendererPort; },
    async loadGlb(url) { calls.urls.push(url); return loaded; },
  };
  const renderer = new ThreeEyewearRenderer({
    factory,
    maximumDevicePixelRatio: 2,
    faceTriangleIndices: new Uint16Array([0, 1, 2]),
    faceLandmarkCount: 3,
  });
  return { renderer, calls, loaded };
}

function frame(overrides = {}) {
  return {
    timestampSeconds: 1,
    pose: {
      position: { x: 0.1, y: 0.2, z: -0.5 },
      rotation: { x: 0, y: 0, z: 0, w: 1 },
      sourceConfidence: 0.9,
    },
    scale: { millimetresPerPixel: null, confidence: "low", sampleCount: 0 },
    opacity: 1,
    ...overrides,
  };
}

test("MediaPipe tessellation converts validated edge triples into triangles", () => {
  const indices = mediaPipeFaceTriangleIndices();
  assert.equal(indices.length, 2556);
  assert.deepEqual([...indices.slice(0, 6)], [127, 34, 139, 11, 0, 37]);
});

test("renderer caps DPR, tracks resize, loads GLB, and applies attachment matrix", async () => {
  const { renderer, calls, loaded } = rendererHarness();
  await renderer.initialize({ clientWidth: 390, clientHeight: 844, width: 390, height: 844 });
  assert.equal(calls.ratios[0], 1);
  renderer.resize(800, 400, 3);
  assert.equal(calls.ratios.at(-1), 2);
  assert.deepEqual(calls.sizes.at(-1), { width: 800, height: 400, updateStyle: false });
  assert.equal(renderer.camera.aspect, 2);
  await renderer.loadAsset(asset());
  assert.deepEqual(calls.urls, ["/assets/j1-m.glb"]);
  assert.equal(renderer.attachmentRoot.children[0], loaded);
  assert.deepEqual(renderer.attachmentRoot.matrix.elements.slice(12, 15), [0.01, 0.02, 0.03]);
});

test("renderer applies pose, confidence opacity, scale correction, and fail-closed visibility", async () => {
  const { renderer, calls, loaded } = rendererHarness();
  await renderer.initialize({ clientWidth: 400, clientHeight: 800, width: 400, height: 800 });
  await renderer.loadAsset(asset());
  renderer.render(frame({ opacity: 0.45, scale: { millimetresPerPixel: 0.6, confidence: "high", sampleCount: 5 } }));
  assert.deepEqual(renderer.poseRoot.position.toArray(), [0.1, 0.2, -0.5]);
  assert.ok(renderer.scaleRoot.scale.x >= 0.65 && renderer.scaleRoot.scale.x <= 1.5);
  assert.equal(loaded.children[0].material.opacity, 0.8 * 0.45);
  renderer.render(frame({ opacity: 0 }));
  assert.equal(loaded.visible, false);
  renderer.render(frame({ pose: { ...frame().pose, position: { x: 0, y: 0, z: -20 } } }));
  assert.equal(loaded.visible, false);
  assert.throws(() => renderer.render(frame({ opacity: 2 })), /between 0 and 1/);
  assert.equal(calls.renders, 3);
});

test("depth-only mesh updates dynamic positions and never writes color", () => {
  const occlusion = new DepthOnlyFaceMesh(3, new Uint16Array([0, 1, 2]));
  const camera = {
    sourceSize: { width: 100, height: 100 },
    viewportSize: { width: 100, height: 100 },
    mirrored: false,
    verticalFovDeg: 50,
    objectFit: "cover",
  };
  occlusion.update({
    landmarks: [
      { x: 0.4, y: 0.4, z: 0 },
      { x: 0.6, y: 0.4, z: 0 },
      { x: 0.5, y: 0.6, z: -0.01 },
    ],
    camera,
    headDepthMetres: 0.5,
    scale: { millimetresPerPixel: 1, confidence: "medium", sampleCount: 3 },
    depthAnchorLandmarkIndex: 0,
  });
  const positions = occlusion.geometry.getAttribute("position");
  assert.ok(positions.version > 0);
  assert.equal(occlusion.material.colorWrite, false);
  assert.equal(occlusion.material.depthWrite, true);
  assert.equal(occlusion.mesh.visible, true);
  assert.ok(positions.getZ(2) > positions.getZ(0));
  occlusion.hide();
  assert.equal(occlusion.mesh.visible, false);
});

test("renderer disposes WebGL and loaded scene resources", async () => {
  const { renderer, calls, loaded } = rendererHarness();
  await renderer.initialize({ clientWidth: 100, clientHeight: 100, width: 100, height: 100 });
  await renderer.loadAsset(asset());
  let geometryDisposed = false;
  loaded.children[0].geometry.addEventListener("dispose", () => { geometryDisposed = true; });
  renderer.dispose();
  assert.equal(calls.disposed, 1);
  assert.equal(geometryDisposed, true);
});
