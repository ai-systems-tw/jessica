import { createHash } from "node:crypto";
import { cp, mkdir, writeFile } from "node:fs/promises";
import { calibrationGlbBytes } from "./generate-calibration-glb.mjs";

const root = new URL("../", import.meta.url);
const source = new URL("apps/try-on-web/public/", root);
const destination = new URL("dist/apps/try-on-web/", root);
await mkdir(destination, { recursive: true });
await cp(source, destination, { recursive: true });
await cp(
  new URL("dist/packages/", root),
  new URL("dist/apps/try-on-web/packages/", root),
  { recursive: true },
);

const mediaPipeWasmSource = new URL("node_modules/@mediapipe/tasks-vision/wasm/", root);
const mediaPipeWasmDestination = new URL(
  "dist/apps/try-on-web/runtime/mediapipe/1.0.1/wasm/",
  root,
);
await mkdir(mediaPipeWasmDestination, { recursive: true });
await cp(mediaPipeWasmSource, mediaPipeWasmDestination, { recursive: true });

const threeDestination = new URL("dist/apps/try-on-web/runtime/three/0.185.1/", root);
await mkdir(new URL("examples/jsm/loaders/", threeDestination), { recursive: true });
await mkdir(new URL("examples/jsm/utils/", threeDestination), { recursive: true });
await cp(
  new URL("node_modules/three/build/three.module.js", root),
  new URL("three.module.js", threeDestination),
);
await cp(
  new URL("node_modules/three/build/three.core.js", root),
  new URL("three.core.js", threeDestination),
);
await cp(
  new URL("node_modules/three/examples/jsm/loaders/GLTFLoader.js", root),
  new URL("examples/jsm/loaders/GLTFLoader.js", threeDestination),
);
await cp(
  new URL("node_modules/three/examples/jsm/utils/BufferGeometryUtils.js", root),
  new URL("examples/jsm/utils/BufferGeometryUtils.js", threeDestination),
);
await cp(
  new URL("node_modules/three/examples/jsm/utils/SkeletonUtils.js", root),
  new URL("examples/jsm/utils/SkeletonUtils.js", threeDestination),
);
await cp(
  new URL("node_modules/@mediapipe/tasks-vision/vision_bundle.mjs", root),
  new URL("dist/apps/try-on-web/runtime/mediapipe/1.0.1/vision_bundle.mjs", root),
);
const assetDirectory = new URL("dist/apps/try-on-web/runtime/assets/", root);
await mkdir(assetDirectory, { recursive: true });
const glbBytes = calibrationGlbBytes();
await writeFile(new URL("calibration-frame.glb", assetDirectory), glbBytes);
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const requiredNodes = ["FRAME_ROOT", "NOSE_ANCHOR", "LENS_LEFT", "LENS_RIGHT", "HINGE_LEFT", "HINGE_RIGHT", "TEMPLE_LEFT", "TEMPLE_RIGHT"];
const manifest = {
  schemaVersion: 1,
  assetId: "calibration-proxy-v1",
  assetVersion: 1,
  fixture: true,
  generator: { name: "Jessica deterministic calibration proxy", version: "1" },
  model: {
    url: "./calibration-frame.glb",
    sha256: hash(glbBytes),
    byteLength: glbBytes.length,
    format: "glb",
    unit: "metre",
    boundsMetres: { min: [-0.063, -0.0195, -0.12], max: [0.063, 0.0195, 0.002] },
    requiredNodes,
  },
  sourceAssetHashes: [],
};
const manifestBytes = Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`, "utf8");
await writeFile(new URL("calibration-frame.json", assetDirectory), manifestBytes);
const asset = {
  id: "calibration-proxy-v1",
  tenantId: "jessica-internal",
  frameModelId: "calibration-proxy",
  version: 1,
  quality: "proxy",
  generationMethod: "proxy-auto",
  modelUrl: "./assets/calibration-frame.glb",
  manifestUrl: "./assets/calibration-frame.json",
  manifestSha256: hash(manifestBytes),
  sourceAssetHashes: [],
  attachmentMatrix: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0.018, 1],
  qualityEnvelope: { maxYawDeg: 15, maxPitchDeg: 10, recommendedForLive: false, scaleConfidence: "low" },
  status: "draft",
};
const entry = {
  schemaVersion: 1,
  tenantId: "jessica-internal",
  model: {
    id: "calibration-proxy",
    tenantId: "jessica-internal",
    modelCode: "CALIBRATION-PROXY",
    name: "Calibration proxy fixture",
    measurements: { lensWidthMm: 52, bridgeWidthMm: 16, templeLengthMm: 120, frameWidthMm: 126, lensHeightMm: 36 },
  },
  variant: {
    id: "calibration-proxy-orange",
    tenantId: "jessica-internal",
    frameModelId: "calibration-proxy",
    sku: "FIXTURE-CALIBRATION-PROXY",
    frameColor: "orange",
    frameMaterial: "acetate",
    lensType: "clear",
  },
  asset,
};
const catalog = { schemaVersion: 1, tenantId: "jessica-internal", defaultSku: entry.variant.sku, entries: [entry] };
await mkdir(new URL("dist/apps/try-on-web/runtime/fixtures/", root), { recursive: true });
await writeFile(new URL("dist/apps/try-on-web/runtime/fixtures/self-test-catalog.json", root), `${JSON.stringify(catalog, null, 2)}\n`);
