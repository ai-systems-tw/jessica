# ADR 0009: Preemptible browser-local tracking Worker

## Status

Accepted — tracking Worker boundary following JSC-0210.

## Decision

The production `public-live` tracking path runs MediaPipe Face Landmarker initialization and synchronous `detectForVideo` only inside a dedicated Worker. MediaPipe Tasks Vision 1.0.1 loads its Emscripten WASM loader through classic `importScripts`, so the entry is a minimal same-origin classic bootstrap that dynamically imports Jessica's ES-module processing graph. The bootstrap buffers init messages until the module listener is installed, then replays them in order. The main thread constructs `WorkerFaceTrackingBackend`; it does not import, instantiate, or invoke the in-process MediaPipe backend. Missing Worker or `createImageBitmap` support fails closed. The in-process adapter remains injectable test/explicit-QA infrastructure and is not a production fallback.

The Worker protocol is `jessica.tracking-worker` version 1 and rejects unknown fields, unknown message kinds, version mismatches, malformed diagnostics, and malformed results. Every message binds a non-empty session ID and positive generation. Frame requests also bind a request ID and a strictly increasing integer microsecond timestamp. Responses must match session, generation, request, and timestamp; stale generations are ignored and current-generation ordering violations terminate the Worker.

Initialization pins the concrete same-origin Worker bootstrap URL, concrete self-hosted MediaPipe module URL, WASM base URL, model URL, `@mediapipe/tasks-vision` version, model SHA-256, model byte length, origin, and delegate. Document import maps are not assumed inside Workers. The Jessica Worker module dynamically imports the explicit allowlisted MediaPipe module URL; the SDK then loads its pinned same-origin WASM loader through the classic Worker capability. The Worker fetches the model once with `credentials: omit`, `cache: no-store`, an exact `Content-Length`, a bounded streaming read, final-redirect origin enforcement, exact byte length, and actual SHA-256 verification, then initializes MediaPipe from the verified buffer. Configured URLs and Worker-side resource origins are returned as diagnostics because window Resource Timing does not necessarily contain Worker-internal requests.

The main thread clones each live source to a transferable `ImageBitmap`. Before successful `postMessage`, ownership stays on the main thread and it closes the bitmap on cancellation, replacement, invalid dimensions, or post failure. After successful transfer, the Worker owns the frame and closes it in `finally` on success, no-face, detection error, stale/non-monotonic input, or disposal races. Worker termination releases already-transferred resources. Malformed messages close any transferred closeable frame before the Worker exits.

Backpressure is bounded to one inference in flight plus one latest frame preparing/queued. A newer queued frame explicitly drops and closes the older queued frame. Bitmap creation completion cannot reorder timestamp submission. Results are plain data and the host validates exact 478-landmark cardinality, finite landmark/transform values, visibility range, image dimensions, confidence, quality reasons, and metrics before the result reaches `PoseAdapter`.

Initialization, inference, and disposal have separate host timeouts. A stalled Worker is terminated and a later initialization creates a new generation. The existing main-thread visibility lease remains independent: it hides the asset at exactly 250 ms while Worker inference is pending, before the longer inference timeout. Lease/generation checks prevent late results or errors from re-showing the asset.

Frames, landmarks, transforms, and face-derived data remain within the browser origin and are never sent to an application server. Analytics/diagnostics contain resource URLs/origins, generations, counters, timing, and error categories only.

## Consequences and limitations

- Synchronous MediaPipe work can no longer block the UI event loop, so a progressing UI thread can enforce the exact 250 ms visibility boundary even when inference stalls.
- A stalled UI event loop still cannot be absolutely preempted by another timer on that same thread. Worker isolation fixes SDK blocking, not arbitrary main-thread long tasks or browser scheduling suspension.
- `ImageBitmap` cloning adds bounded transfer/copy overhead; runtime performance accounting includes clone/Worker round-trip in the awaited detection duration and separately exposes deterministic Worker counters.
- Worker termination is the authoritative recovery for hung synchronous inference; graceful `dispose` is best-effort within a short timeout.
- The classic bootstrap is a deliberate compatibility boundary for pinned MediaPipe 1.0.1, not an in-process fallback. Removing it requires an SDK/WASM-loader version proven to initialize in a module Worker.
- Physical-device, sustained-performance, J1-M, and canonical G1 evidence remain external gates and are not established by this ADR.
