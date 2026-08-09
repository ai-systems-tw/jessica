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
