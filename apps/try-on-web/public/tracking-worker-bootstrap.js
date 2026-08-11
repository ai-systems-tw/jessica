// MediaPipe Tasks Vision 1.0.1 loads its Emscripten WASM loader with
// importScripts(), which is unavailable in a module Worker. Keep this classic
// bootstrap minimal and move all Jessica logic into the imported ES module.
const pendingMessages = [];
const bufferUntilModuleReady = (event) => pendingMessages.push(event.data);
self.addEventListener("message", bufferUntilModuleReady);

void import("./src/tracking.worker.js").then(() => {
  self.removeEventListener("message", bufferUntilModuleReady);
  for (const data of pendingMessages) self.dispatchEvent(new MessageEvent("message", { data }));
  pendingMessages.length = 0;
}).catch((error) => {
  setTimeout(() => {
    throw error;
  }, 0);
});
