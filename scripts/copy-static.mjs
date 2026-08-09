import { cp, mkdir } from "node:fs/promises";

const root = new URL("../", import.meta.url);
const source = new URL("apps/try-on-web/public/", root);
const destination = new URL("dist/apps/try-on-web/", root);
await mkdir(destination, { recursive: true });
await cp(source, destination, { recursive: true });

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
