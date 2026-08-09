# MediaPipe runtime assets

The build copies the pinned `@mediapipe/tasks-vision@1.0.1` WASM files to
`./1.0.1/wasm/` in the build output.

The Face Landmarker task model is deliberately not fetched from a public CDN at
runtime. Provision the reviewed model as `./face_landmarker.task` (or configure
another self-hosted path) before enabling live tracking.

Run `npm run provision:mediapipe` to download the exact model and static portrait
fixture with pinned SHA-256 verification. `?selfTest=1` exercises the complete
browser module/model/GLB pipeline without requesting camera permission.
